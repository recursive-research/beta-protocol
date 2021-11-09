import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ethers } from 'hardhat';
import { BigNumber as BN } from 'ethers';
import { Tokens } from '../constants';
import { deployStableVault, getERC20, getTokens } from '../test/utils';
import { StableVault } from '../typechain';

async function main() {
  // get addresses
  const signers: SignerWithAddress[] = await ethers.getSigners();
  const [admin, alice, bob, charlie] = signers;

  // get tokens
  const usdc = await getERC20(Tokens.usdc);
  const usdt = await getERC20(Tokens.usdt);

  // deploy stablevault
  console.log('Deploying contracts...');
  const stableVault: StableVault = await deployStableVault(admin);
  const svUsdc = await ethers.getContractAt('StableVaultToken', await stableVault.svUsdc());
  const svUsdt = await ethers.getContractAt('StableVaultToken', await stableVault.svUsdt());
  const uniV2pair = await getERC20(await stableVault.pair());

  // users acquire tokens
  // -- Alice gets 7.5m USDC
  // -- Bob gets 2.5m USDC
  // -- Charlie gets 1m USDT
  console.log('Making deposits...');
  const usdcDepositAlice = BN.from(7500000).mul(1e6);
  const usdcDepositBob = BN.from(2500000).mul(1e6);
  const usdtDepositCharlie = BN.from(1000000).mul(1e6);

  await getTokens(alice, usdc, usdcDepositAlice);
  await getTokens(bob, usdc, usdcDepositBob);
  await getTokens(charlie, usdt, usdtDepositCharlie);

  // users make approvals and make deposit
  await usdc.connect(alice).approve(stableVault.address, usdcDepositAlice);
  await usdc.connect(bob).approve(stableVault.address, usdcDepositBob);
  await usdt.connect(charlie).approve(stableVault.address, usdtDepositCharlie);

  await stableVault.connect(alice).depositToken(usdc.address, usdcDepositAlice);
  await stableVault.connect(bob).depositToken(usdc.address, usdcDepositBob);
  await stableVault.connect(charlie).depositToken(usdt.address, usdtDepositCharlie);

  const aliceSvUsdcBalance = (await svUsdc.balanceOf(alice.address)).div(1e6);
  const bobSvUsdcBalance = (await svUsdc.balanceOf(bob.address)).div(1e6);
  const charlieSvUsdtBalance = (await svUsdt.balanceOf(charlie.address)).div(1e6);
  console.log('----------------------');
  console.log('Alice svUSDC balance:', aliceSvUsdcBalance.toString());
  console.log('Bob svUSDC balance:', bobSvUsdcBalance.toString());
  console.log('Charlie svUSDT balance:', charlieSvUsdtBalance.toString());

  const vaultUsdcBalance = (await usdc.balanceOf(stableVault.address)).div(1e6);
  const vaultUsdtBalance = (await usdt.balanceOf(stableVault.address)).div(1e6);
  console.log('Vault USDC balance', vaultUsdcBalance.toString());
  console.log('Vault USDT balance', vaultUsdtBalance.toString());
  console.log('----------------------');

  // admin establishes LP position
  console.log('Establishing LP position...');
  // -- we have 10m USDC and 1m USDT. swap 4.5m USDC for ~4.5m USDT, and end with ~5.5m of each
  const swapAmountIn = BN.from(4500000).mul(1e6);
  const swapAmountOutMin = BN.from(4494500).mul(1e6);
  const swapUsdc = true;
  // -- minimum amounts of each to deploy to the LP position
  const minUsdc = BN.from(5480000).mul(1e6);
  const minUsdt = BN.from(5494500).mul(1e6);
  await stableVault.addLiquidity(minUsdc, minUsdt, swapAmountIn, swapAmountOutMin, swapUsdc);

  const remainingUsdcBalance = (await usdc.balanceOf(stableVault.address)).div(1e6);
  const remainingUsdtBalance = (await usdt.balanceOf(stableVault.address)).div(1e6);
  console.log('UniV2 LP Tokens:', (await uniV2pair.balanceOf(stableVault.address)).toString());
  console.log('Remaining USDC balance', remainingUsdcBalance.toString());
  console.log('Remaining USDT balance', remainingUsdtBalance.toString());
  console.log('----------------------');
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
