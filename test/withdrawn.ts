import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { BigNumber } from 'ethers';
import { ethers } from 'hardhat';
import { Addresses, Deployments, poolLP, ethLP } from '../constants';
import { getERC20, impersonateAccount } from './utils';

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
    await alice.sendTransaction({ to: poolLP[i], value: ethers.utils.parseEther('1') });
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

async function main() {
  await activate();
  const vault = await ethers.getContractAt('Vault', Deployments.mainnet.vault);
  const multisig = await ethers.getSigner(Addresses.gnosis_beta);
  const withdrawn = await ethers.getContractFactory('Withdrawn');
  const withdrawnContract = await withdrawn.deploy(Deployments.mainnet.vault, poolAddresses);
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
    const totalToken = await token.balanceOf(poolAddress);
    await pool.connect(multisig).migrateLiquidity(withdrawnContract.address);
    // Total Undeemed LP
    const UndeemedSupply = await withdrawnContract.poolToUnredeemedSupply(poolAddress);
    // get LP holder for the corresponding pool
    const LPHolder = await ethers.getSigner(poolLP[i]);
    //get LP Balance from Rift Pool
    const LPAmt = await pool.balanceOf(LPHolder.address);
    await impersonateAccount(LPHolder.address);
    // approve the withdraw contract on Rift Pool LP tokens
    await pool.connect(LPHolder).approve(withdrawnContract.address, LPAmt);
    const balanceBeforeWithdrawn = await token.balanceOf(LPHolder.address);
    // withdraw from the Withdrawn Contract
    await withdrawnContract.connect(LPHolder).withdrawToken(pool.address);
    const balanceAfterWithdrawn = await token.balanceOf(LPHolder.address);
    const withdrawnAmt = balanceAfterWithdrawn.sub(balanceBeforeWithdrawn);
    // supposedAmt = LPAmt/UndeedmedSupply * totalToken
    const supposedAmt = calcWithdrawAmt(UndeemedSupply, LPAmt, totalToken);
    expect(withdrawnAmt).equal(supposedAmt);
    console.log('Withdraw ', ethers.utils.formatUnits(withdrawnAmt, 18));
    console.log('Supposed ', ethers.utils.formatUnits(supposedAmt, 18));
    await expect(withdrawnContract.connect(LPHolder).withdrawToken(pool.address)).to.be.revertedWith('NO LIQUIDITY');
  }
  // get vault eth balances
  let remainETH = await ethers.provider.getBalance(vault.address);
  await vault.connect(multisig).migrateLiquidity(withdrawnContract.address);
  // Migrate Liquidity for Vault
  for (let i = 0; i < ethLP.length; i++) {
    const ethHolder = await ethers.getSigner(ethLP[i]);
    await impersonateAccount(ethHolder.address);
    const vaultUndeemedSupply = await withdrawnContract.vaultUnredeemedSupply();
    const vaultLpBalance = await vault.balanceOf(ethLP[i]);
    const balanceBeforeWithdrawn = await ethers.provider.getBalance(ethLP[i]);
    await vault.connect(ethHolder).approve(withdrawnContract.address, vaultLpBalance);
    await withdrawnContract.connect(ethHolder).withdrawETH();
    const balanceAfterWithdrawn = await ethers.provider.getBalance(ethLP[i]);
    const withdrawAmt = balanceAfterWithdrawn.sub(balanceBeforeWithdrawn);
    // SupposedWithdrawnETH = LPBalance/TotalLP * remainETH
    const supposedAmt = calcWithdrawAmt(vaultUndeemedSupply, vaultLpBalance, remainETH);
    console.log('Withdrawn  ', ethers.utils.formatUnits(withdrawAmt, 18));
    console.log('Supposed  ', ethers.utils.formatUnits(supposedAmt, 18));
    // supposed amt and withdrawn amt might be different due to gas
    remainETH = remainETH.sub(supposedAmt);
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
