import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { BigNumber } from 'ethers';
import { ethers } from 'hardhat';
import { Addresses, Deployments, poolLPAddr, ethLPAddr } from '../constants';
import { getERC20, impersonateAccount } from './utils';
import { SushiPool, RiftV1Withdraw, Vault, UniPool, ERC20 } from '../typechain/';
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
const poolLP = [
  poolLPAddr.luna,
  poolLPAddr.prq,
  poolLPAddr.uft,
  poolLPAddr.ramp,
  poolLPAddr.alcx,
  poolLPAddr.ftm,
  poolLPAddr.inj,
  poolLPAddr.pond,
];
const ethLP = ethLPAddr;
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
}

// caulculate the theoretical withdrawn amount
function calcWithdrawAmt(totalLp: BigNumber, LpBalance: BigNumber, totalToken: BigNumber) {
  return LpBalance.mul(totalToken).div(totalLp);
}

async function processPoolWithdraw(
  riftPoolContract: SushiPool | UniPool,
  LpHolderAddr: string,
  withdrawnContract: RiftV1Withdraw,
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

async function processVaultWithdraw(
  vault: Vault,
  LpHolder: string,
  withdrawnContract: RiftV1Withdraw,
  totalEth: BigNumber,
) {
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

describe('RiftV1Withdraw Unit Tests', async function () {
  let vault;
  let multisig;
  let withdrawnContract: RiftV1Withdraw;

  it('Withdraw From Each Pool and Vault Once', async function () {
    await activate();
    vault = await ethers.getContractAt('Vault', Deployments.mainnet.vault);
    multisig = await ethers.getSigner(Addresses.gnosis_beta);
    const withdrawn = await ethers.getContractFactory('RiftV1Withdraw');
    withdrawnContract = await withdrawn.deploy(Deployments.mainnet.vault, poolAddresses, Addresses.gnosis_beta);

    // Process Pool
    for (let i = 0; i < poolAddresses.length; i++) {
      // Migrate Liquidity for Pool
      const poolAddress = poolAddresses[i];
      const isSushiPool = sushiPools.includes(poolAddress);
      const pool = isSushiPool
        ? await ethers.getContractAt('SushiPool', poolAddress)
        : await ethers.getContractAt('UniPool', poolAddress);
      const token = await getERC20(await pool.token());
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
      // compute the difference between withdrawn amt and suppose amt, should not be greater than 0.1 ETH
      const gas = withdrawnAmt.sub(supposedAmt);
      expect(gas.lte(ethers.utils.parseEther('0.1')));
    }
  });

  it('Withdraw Twice Expected To Fail', async () => {
    for (let i = 0; i < poolAddresses.length; i++) {
      const poolAddress = poolAddresses[i];
      const isSushiPool = sushiPools.includes(poolAddress);
      const pool = isSushiPool
        ? await ethers.getContractAt('SushiPool', poolAddress)
        : await ethers.getContractAt('UniPool', poolAddress);
      for (const LpHolderAddr of poolLP[i]) {
        const LpHolder = await ethers.getSigner(LpHolderAddr);
        await expect(withdrawnContract.connect(LpHolder).withdrawToken(pool.address)).to.be.revertedWith(
          'NO LIQUIDITY',
        );
      }
    }
    for (const ethLpAddr of ethLP) {
      const LpHolder = await ethers.getSigner(ethLpAddr);
      await expect(withdrawnContract.connect(LpHolder).withdrawETH()).to.be.revertedWith('NO LIQUIDITY');
    }
  });
});
