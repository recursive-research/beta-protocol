import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ethers } from 'hardhat';
import { BigNumber as BN } from 'ethers';
import { Addresses, Contracts, Deployments, Tokens } from '../../constants';
import { impersonateAccount, getERC20, getTokens } from '../../test/utils';
import { IUniswapV2Router02__factory, StableVault } from '../../typechain';

async function main() {
  // get addresses
  const signers: SignerWithAddress[] = await ethers.getSigners();
  const multisig = await ethers.getSigner(Addresses.gnosis_beta);
  await impersonateAccount(multisig.address);
  const [, alice, rando] = signers;
  await alice.sendTransaction({ to: multisig.address, value: ethers.utils.parseEther('100') });

  // get tokens
  const usdc = await getERC20(Tokens.usdc);
  const usdt = await getERC20(Tokens.usdt);

  // get live contracts
  const stableVault: StableVault = await ethers.getContractAt('StableVault', Deployments.mainnet.stableVault);
  const uniV2pair = await getERC20(await stableVault.pair());

  const usdcDeposits = await usdc.balanceOf(stableVault.address);
  const usdtDeposits = await usdt.balanceOf(stableVault.address);
  console.log('Vault USDC balance', usdcDeposits.div(1e6).toString());
  console.log('Vault USDT balance', usdtDeposits.div(1e6).toString());
  console.log('----------------------');

  // admin establishes LP position
  console.log('Establishing LP position...');
  const usdtSurplus = usdtDeposits.sub(usdcDeposits);
  const swapAmountIn = usdtSurplus.div(2);
  const swapAmountOutMin = swapAmountIn.mul(99).div(100);
  const swapUsdc = false;
  // -- minimum amounts of each to deploy to the LP position
  const minUsdc = usdtDeposits.sub(swapAmountIn).mul(99).div(100);
  const minUsdt = usdcDeposits.add(swapAmountOutMin).mul(99).div(100);

  console.log('swapping', swapAmountIn.toString(), ' usdt for', swapAmountOutMin.toString(), 'min usdc');
  await stableVault.connect(multisig).addLiquidity(minUsdc, minUsdt, swapAmountIn, swapAmountOutMin, swapUsdc);

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
  const returns = totalAllocation.sub(usdcDeposits.add(usdtDeposits));
  const usdcReturn = returns.mul(usdcDeposits).div(usdtDeposits);
  const usdcExcess = vaultUsdcAlloction.sub(usdcDeposits).sub(usdcReturn);

  const swapAmountInUsdc = usdcExcess;
  const swapAmountOutUsdt = 0;
  const _swapUsdc = true;
  const _minUsdc = 0;
  const _minUsdt = 0;

  await stableVault
    .connect(multisig)
    .removeLiquidity(_minUsdc, _minUsdt, swapAmountInUsdc, swapAmountOutUsdt, _swapUsdc);

  const vaultUsdcBalance = (await usdc.balanceOf(stableVault.address)).div(1e6);
  const vaultUsdtBalance = (await usdt.balanceOf(stableVault.address)).div(1e6);
  console.log('Vault USDC balance', vaultUsdcBalance.toString());
  console.log('Vault USDT balance', vaultUsdtBalance.toString());
  console.log('----------------------');
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
