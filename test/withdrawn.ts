import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { BigNumber, Signer } from 'ethers';
import { ethers } from 'hardhat';
import { Addresses, Deployments, poolLP, ethLP } from '../constants';
import { getERC20, impersonateAccount } from './utils';
import { SushiPool, Withdrawn, Vault, UniPool, ERC20 } from '../typechain/';
const uniPools = [
  Deployments.mainnet.wlunaPool,
  Deployments.mainnet.prqPool,
  Deployments.mainnet.uftPool,
  Deployments.mainnet.rampPool,
];
const sushiPools = [
  Deployments.mainnet.alcxPool,
  Deployments.mainnet.ftmPool,
  Deployments.mainnet.injPool,
  Deployments.mainnet.pondPool,
];

const poolAddresses = uniPools.concat(sushiPools);
// next Phase and fund the wallets that we need to interact
async function activate() {
  const signers: SignerWithAddress[] = await ethers.getSigners();
  const multisig = await ethers.getSigner(Addresses.gnosis_beta);
  await impersonateAccount(multisig.address);
  const [, alice] = signers;
  // fund multisigs
  await alice.sendTransaction({ to: multisig.address, value: ethers.utils.parseEther('100') });
  const vault = await ethers.getContractAt('Vault', Deployments.mainnet.vault);
  //unpair pool liquidity and fund lp holders
  for (let i = 0; i < poolAddresses.length; i++) {
    const poolAddress = poolAddresses[i];
    await vault.connect(multisig).unpairLiquidityPool(poolAddress, 0, 0);
    for (const LpHolder of poolLP[i]) {
      await alice.sendTransaction({ to: LpHolder, value: ethers.utils.parseEther('1') });
    }
  }
  for (let i = 0; i < ethLP.length; i++) {
    await alice.sendTransaction({ to: ethLP[i], value: ethers.utils.parseEther('1') });
  }
  await vault.connect(multisig).nextPhase();
  await vault.connect(multisig).unwrapEth();
  console.log('Finish Advancing Phase');
}

// caulculate the theoretical withdrawn amount
function calcWithdrawAmt(totalLp: BigNumber, LpBalance: BigNumber, totalToken: BigNumber) {
  return LpBalance.mul(totalToken).div(totalLp);
}

async function processPoolWithdraw(
  riftPoolContract: SushiPool | UniPool,
  LpHolderAddr: string,
  withdrawnContract: Withdrawn,
  token: ERC20,
  totalToken: BigNumber,
) {
  const poolAddr = riftPoolContract.address;
  const UndeemedSupply = await withdrawnContract.poolToUnredeemedSupply(poolAddr);
  const LpHolder = await ethers.getSigner(LpHolderAddr);
  const LPAmt = await riftPoolContract.balanceOf(LpHolderAddr);
  await impersonateAccount(LpHolderAddr);
  await riftPoolContract.connect(LpHolder).approve(withdrawnContract.address, LPAmt);
  const balanceBeforeWithdrawn = await token.balanceOf(LpHolderAddr);
  // withdraw from the Withdrawn Contract
  await withdrawnContract.connect(LpHolder).withdrawToken(poolAddr);
  const balanceAfterWithdrawn = await token.balanceOf(LpHolderAddr);
  const withdrawnAmt = balanceAfterWithdrawn.sub(balanceBeforeWithdrawn);
  // supposedAmt = LPAmt/UndeedmedSupply * totalToken
  const supposedAmt = calcWithdrawAmt(UndeemedSupply, LPAmt, totalToken);
  return [withdrawnAmt, supposedAmt];
}

async function processVaultWithdraw(vault: Vault, LpHolder: string, withdrawnContract: Withdrawn, totalEth: BigNumber) {
  const ethHolder = await ethers.getSigner(LpHolder);
  await impersonateAccount(LpHolder);
  const vaultUndeemedSupply = await withdrawnContract.vaultUnredeemedSupply();
  const vaultLpBalance = await vault.balanceOf(LpHolder);
  const balanceBeforeWithdrawn = await ethers.provider.getBalance(LpHolder);
  await vault.connect(ethHolder).approve(withdrawnContract.address, vaultLpBalance);
  await withdrawnContract.connect(ethHolder).withdrawETH();
  const balanceAfterWithdrawn = await ethers.provider.getBalance(LpHolder);
  const withdrawAmt = balanceAfterWithdrawn.sub(balanceBeforeWithdrawn);
  // SupposedWithdrawnETH = LPBalance/TotalLP * remainETH
  const supposedAmt = calcWithdrawAmt(vaultUndeemedSupply, vaultLpBalance, totalEth);
  return [withdrawAmt, supposedAmt];
}

describe('Withdrawn Unit Tests', () => {
  let vault: Vault;
  let withdrawnContract: Withdrawn;
  let multisig: Signer;
  beforeEach(async () => {
    await activate();
    vault = await ethers.getContractAt('Vault', Deployments.mainnet.vault);
    multisig = await ethers.getSigner(Addresses.gnosis_beta);
    const withdrawn = await ethers.getContractFactory('Withdrawn');
    withdrawnContract = await withdrawn.deploy(Deployments.mainnet.vault, poolAddresses);
  });
  describe('Withdraw From Each Pool and Vault Once', async () => {
    // Process Pool
    for (let i = 0; i < poolAddresses.length; i++) {
      // Migrate Liquidity for Pool
      const poolAddress = poolAddresses[i];
      const isSushiPool = sushiPools.includes(poolAddress);
      const pool = isSushiPool
        ? await ethers.getContractAt('SushiPool', poolAddress)
        : await ethers.getContractAt('UniPool', poolAddress);
      const token = await getERC20(await pool.token());
      console.log('migrating liquidity for ', await token.symbol());
      // Balance of token in the Rift Pool
      let totalToken = await token.balanceOf(poolAddress);
      await pool.connect(multisig).migrateLiquidity(withdrawnContract.address);
      for (const LpHolderAddr of poolLP[i]) {
        const [withdrawAmt, supposedAmt] = await processPoolWithdraw(
          pool,
          LpHolderAddr,
          withdrawnContract,
          token,
          totalToken,
        );
        totalToken = totalToken.sub(withdrawAmt);
        expect(withdrawAmt).to.be.equal(supposedAmt);
      }
    }
    // Process Vault
    // get vault eth balances
    let totalEth = await ethers.provider.getBalance(vault.address);
    await vault.connect(multisig).migrateLiquidity(withdrawnContract.address);
    // Migrate Liquidity for Vault
    for (const ethLpAddr of ethLP) {
      const [withdrawnAmt, supposedAmt] = await processVaultWithdraw(vault, ethLpAddr, withdrawnContract, totalEth);
      // supposed amt and withdrawn amt might be different due to gas
      totalEth = totalEth.sub(supposedAmt);
      expect(withdrawnAmt.sub(supposedAmt)).to.be.lessThan(ethers.utils.parseEther('0.1'));
    }
  });
  describe('Withdraw Twice Expected To Fail', async () => {
    for (let i = 0; i < poolAddresses.length; i++) {
      const poolAddress = poolAddresses[i];
      const isSushiPool = sushiPools.includes(poolAddress);
      const pool = isSushiPool
        ? await ethers.getContractAt('SushiPool', poolAddress)
        : await ethers.getContractAt('UniPool', poolAddress);
      await pool.connect(multisig).migrateLiquidity(withdrawnContract.address);
      for (const LpHolderAddr of poolLP[i]) {
        const LpHolder = await ethers.getSigner(LpHolderAddr);
        await withdrawnContract.connect(LpHolder).withdrawToken(pool.address);
        await expect(withdrawnContract.connect(LpHolder).withdrawToken(pool.address)).to.be.revertedWith(
          'NO LIQUIDITY',
        );
      }
    }
    await vault.connect(multisig).migrateLiquidity(withdrawnContract.address);
    for (const ethLpAddr of ethLP) {
      const LpHolder = await ethers.getSigner(ethLpAddr);
      await withdrawnContract.connect(LpHolder).withdrawETH();
      await expect(withdrawnContract.connect(LpHolder).withdrawETH()).to.be.revertedWith('NO LIQUIDITY');
    }
  });
});
