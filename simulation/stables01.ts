import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ethers } from 'hardhat';
import { BigNumber as BN } from 'ethers';
import { Addresses, Contracts, Tokens } from '../constants';
import { deployStableVault, getERC20, getTokens } from '../test/utils';
import { IUniswapV2Router02__factory, StableVault } from '../typechain';

async function main() {
  // get addresses
  const signers: SignerWithAddress[] = await ethers.getSigners();
  const [admin, alice, bob, charlie, rando] = signers;

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

  let vaultUsdcBalance = (await usdc.balanceOf(stableVault.address)).div(1e6);
  let vaultUsdtBalance = (await usdt.balanceOf(stableVault.address)).div(1e6);
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

  // allow random users to swap between usdc<>usdt while position is deployed
  console.log('Collecting swap fees...');
  // -- get rando 1m of each to swap with
  const uniRouter = IUniswapV2Router02__factory.connect(Contracts.uniswapRouter, rando);

  // get the user 10mm usdc
  const randoUsdcAmount = BN.from(10000000).mul(1e6);
  await getTokens(rando, usdc, randoUsdcAmount);

  await usdc.connect(rando).approve(uniRouter.address, ethers.constants.MaxUint256);
  await usdt.connect(rando).approve(uniRouter.address, ethers.constants.MaxUint256);

  // -- rando makes swaps to and from usdc/t
  // -- there's 1-7mm of volume per day, so we'll get ~150mm of swaps to simulate about 1 month
  for (let i = 0; i < 14; i++) {
    if (i % 2 == 0) {
      const randoBalance = await usdc.balanceOf(rando.address);
      await uniRouter
        .connect(rando)
        .swapExactTokensForTokens(randoBalance, 0, [usdc.address, usdt.address], rando.address, 2000000000);
    } else {
      const randoBalance = await usdt.balanceOf(rando.address);
      await uniRouter
        .connect(rando)
        .swapExactTokensForTokens(randoBalance, 0, [usdt.address, usdc.address], rando.address, 2000000000);
    }
  }

  // Unpair liquidity
  console.log('----------------------');
  console.log('Unpairing liquidity position...');

  const usdcReserve = await usdc.balanceOf(uniV2pair.address);
  const usdtReserve = await usdt.balanceOf(uniV2pair.address);
  const vaultLpBalance = await uniV2pair.balanceOf(stableVault.address);
  const lpSupply = await uniV2pair.totalSupply();
  const vaultUsdcAlloction = usdcReserve.mul(vaultLpBalance).div(lpSupply);
  const vaultUsdtAlloction = usdtReserve.mul(vaultLpBalance).div(lpSupply);
  const totalAllocation = vaultUsdcAlloction.add(vaultUsdtAlloction);
  const usdcDeposits = usdcDepositAlice.add(usdcDepositBob);
  const usdtDeposits = usdtDepositCharlie;
  const returns = totalAllocation.sub(usdcDeposits.add(usdtDeposits));
  const usdtReturn = returns.mul(usdtDeposits).div(usdcDeposits);
  const usdtExcess = vaultUsdtAlloction.sub(usdtDeposits).sub(usdtReturn);

  const swapAmountInUsdt = usdtExcess;
  const swapAmountOutUsdc = 0;
  const _swapUsdc = false;
  const _minUsdc = 0;
  const _minUsdt = 0;

  await stableVault.removeLiquidity(_minUsdc, _minUsdt, swapAmountInUsdt, swapAmountOutUsdc, _swapUsdc);

  vaultUsdcBalance = (await usdc.balanceOf(stableVault.address)).div(1e6);
  vaultUsdtBalance = (await usdt.balanceOf(stableVault.address)).div(1e6);
  console.log('Vault USDC balance', vaultUsdcBalance.toString());
  console.log('Vault USDT balance', vaultUsdtBalance.toString());
  console.log('----------------------');

  // Withdraws
  await stableVault.connect(alice).withdrawToken(usdc.address, Addresses.zero);
  const aliceUsdcBalanceFinal = await usdc.balanceOf(alice.address);
  console.log(
    'Alice USDC returns:',
    aliceUsdcBalanceFinal.sub(usdcDepositAlice).div(1e6).toString(),
    'on initial deposit of ',
    usdcDepositAlice.div(1e6).toString(),
  );

  await stableVault.connect(bob).withdrawToken(usdc.address, Addresses.zero);
  const bobUsdcBalanceFinal = await usdc.balanceOf(bob.address);
  console.log(
    'Bob USDC returns:',
    bobUsdcBalanceFinal.sub(usdcDepositBob).div(1e6).toString(),
    'on initial deposit of ',
    usdcDepositBob.div(1e6).toString(),
  );

  await stableVault.connect(charlie).withdrawToken(usdt.address, Addresses.zero);
  const charlieUsdtBalanceFinal = await usdt.balanceOf(charlie.address);
  console.log(
    'Charlie USDT returns:',
    charlieUsdtBalanceFinal.sub(usdtDepositCharlie).div(1e6).toString(),
    'on initial deposit of ',
    usdtDepositCharlie.div(1e6).toString(),
  );
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
