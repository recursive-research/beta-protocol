import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { BigNumber } from 'ethers';
import { ethers } from 'hardhat';
import { Addresses, Deployments } from '../constants';
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
const LPHolders = [
  Addresses.lunaLP,
  Addresses.prqLP,
  Addresses.uftLP,
  Addresses.rampLP,
  Addresses.alcxLP,
  Addresses.ftmLP,
  Addresses.injLP,
  Addresses.pondLP,
];

const poolAddresses = uniPools.concat(sushiPools);
async function activate() {
  const signers: SignerWithAddress[] = await ethers.getSigners();
  const multisig = await ethers.getSigner(Addresses.gnosis_beta);
  await impersonateAccount(multisig.address);
  const [, alice] = signers;
  await alice.sendTransaction({ to: multisig.address, value: ethers.utils.parseEther('100') }); // fund multisig
  const vault = await ethers.getContractAt('Vault', Deployments.mainnet.vault);
  for (let i = 0; i < poolAddresses.length; i++) {
    const poolAddress = poolAddresses[i];
    await vault.connect(multisig).unpairLiquidityPool(poolAddress, 0, 0);
    await alice.sendTransaction({ to: LPHolders[i], value: ethers.utils.parseEther('1') });
  }
  await vault.connect(multisig).nextPhase();
  await vault.connect(multisig).unwrapEth();
  console.log('Finish Advancing Phase');
}

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
    const totalToken = await token.balanceOf(poolAddress);
    await pool.connect(multisig).migrateLiquidity(withdrawnContract.address);
    const UndeemedSupply = await withdrawnContract.poolToUnredeemedSupply(poolAddress);
    const LPHolder = await ethers.getSigner(LPHolders[i]);
    const LPAmt = await pool.balanceOf(LPHolder.address);
    await impersonateAccount(LPHolder.address);
    await pool.connect(LPHolder).approve(withdrawnContract.address, LPAmt);
    const balanceBeforeWithdrawn = await token.balanceOf(LPHolder.address);
    await withdrawnContract.connect(LPHolder).withdrawToken(pool.address);
    const balanceAfterWithdrawn = await token.balanceOf(LPHolder.address);
    const withdrawnAmt = balanceAfterWithdrawn.sub(balanceBeforeWithdrawn);
    const supposedAmt = calcWithdrawAmt(UndeemedSupply, LPAmt, totalToken);
    expect(withdrawnAmt).equal(supposedAmt);
    console.log('Withdraw ', ethers.utils.formatUnits(withdrawnAmt, 18));
    console.log('Supposed ', ethers.utils.formatUnits(supposedAmt, 18));
    await expect(withdrawnContract.connect(LPHolder).withdrawToken(pool.address)).to.be.revertedWith(
      'No Deposited Liquidity',
    );
  }
  // Migrate Liquidity for Vault
  const ETHBalance = await ethers.provider.getBalance(vault.address);
  const ethHolder = await ethers.getSigner(Addresses.ethLP);
  await impersonateAccount(ethHolder.address);
  await vault.connect(multisig).migrateLiquidity(withdrawnContract.address);
  const vaultUndeemedSupply = await withdrawnContract.vaultUnredeemedSupply();
  const vaultLpBalance = await vault.balanceOf(Addresses.ethLP);
  const balanceBeforeWithdrawn = await ethers.provider.getBalance(Addresses.ethLP);
  await vault.connect(ethHolder).approve(withdrawnContract.address, vaultLpBalance);
  await withdrawnContract.connect(ethHolder).withdrawETH();
  const balanceAfterWithdrawn = await ethers.provider.getBalance(Addresses.ethLP);
  console.log('Withdrawn Amount: ', ethers.utils.formatUnits(balanceAfterWithdrawn.sub(balanceBeforeWithdrawn), 18));
  console.log(
    'Supposed Amt : ',
    ethers.utils.formatUnits(calcWithdrawAmt(vaultUndeemedSupply, vaultLpBalance, ETHBalance), 18),
  );
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
