import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ethers } from 'hardhat';
import { Addresses, Contracts, Deployments, Tokens } from '../../constants';
import { getERC20, getTokens, getWETH, impersonateAccount } from '../../test/utils';
import { IUniswapV2Router02__factory, StableVault } from '../../typechain';

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

async function main() {
  // get addresses
  const signers: SignerWithAddress[] = await ethers.getSigners();
  const multisig = await ethers.getSigner(Addresses.gnosis_beta);
  await impersonateAccount(multisig.address);
  const [, alice, bob] = signers;
  await alice.sendTransaction({ to: multisig.address, value: ethers.utils.parseEther('100') }); // fund multisig

  ////////////////////////////////////////////////////
  ///////             Stable Vault             ///////
  ////////////////////////////////////////////////////

  // start with Stables
  console.log('Establishing Stables position...');
  // get tokens
  const usdc = await getERC20(Tokens.usdc);
  const usdt = await getERC20(Tokens.usdt);

  // get live contracts
  const stableVault: StableVault = await ethers.getContractAt('StableVault', Deployments.mainnet.stableVault);
  const uniV2pair = await getERC20(await stableVault.pair());

  const usdcDeposits = await usdc.balanceOf(stableVault.address);
  const usdtDeposits = await usdt.balanceOf(stableVault.address);

  const swapAmountIn = ethers.utils.parseUnits('3000000', 6);
  const swapAmountOutMin = ethers.utils.parseUnits('2997500', 6);
  const swapUsdc = true;

  const minUsdc = ethers.utils.parseUnits('7450000', 6);
  const minUsdt = ethers.utils.parseUnits('7499400');

  await stableVault.connect(multisig).addLiquidity(minUsdc, minUsdt, swapAmountIn, swapAmountOutMin, swapUsdc);

  const remainingUsdcBalance = (await usdc.balanceOf(stableVault.address)).div(1e6);
  const remainingUsdtBalance = (await usdt.balanceOf(stableVault.address)).div(1e6);
  console.log('UniV2 LP Tokens:', (await uniV2pair.balanceOf(stableVault.address)).toString());
  console.log('Remaining USDC balance', remainingUsdcBalance.toString());
  console.log('Remaining USDT balance', remainingUsdtBalance.toString());

  // -- get bob 1m of each to swap with
  const uniRouter = IUniswapV2Router02__factory.connect(Contracts.uniswapRouter, bob);

  // get the user 10mm usdc
  const randoUsdcAmount = ethers.BigNumber.from(10000000).mul(1e6);
  await getTokens(bob, usdc, randoUsdcAmount);

  await usdc.connect(bob).approve(uniRouter.address, ethers.constants.MaxUint256);
  await usdt.connect(bob).approve(uniRouter.address, ethers.constants.MaxUint256);

  // -- bob makes swaps to and from usdc/t
  // -- there's 1-7mm of volume per day, so we'll get ~150mm of swaps to simulate about 1 month
  for (let i = 0; i < 14; i++) {
    if (i % 2 == 0) {
      const bobBalance = await usdc.balanceOf(bob.address);
      await uniRouter
        .connect(bob)
        .swapExactTokensForTokens(bobBalance, 0, [usdc.address, usdt.address], bob.address, 2000000000);
    } else {
      const bobBalance = await usdt.balanceOf(bob.address);
      await uniRouter
        .connect(bob)
        .swapExactTokensForTokens(bobBalance, 0, [usdt.address, usdc.address], bob.address, 2000000000);
    }
  }

  const usdcReserve = await usdc.balanceOf(uniV2pair.address);
  const usdtReserve = await usdt.balanceOf(uniV2pair.address);
  const vaultLpBalance = await uniV2pair.balanceOf(stableVault.address);
  const lpSupply = await uniV2pair.totalSupply();
  const vaultUsdcAlloction = usdcReserve.mul(vaultLpBalance).div(lpSupply);
  const vaultUsdtAlloction = usdtReserve.mul(vaultLpBalance).div(lpSupply);
  const totalAllocation = vaultUsdcAlloction.add(vaultUsdtAlloction);
  const returns = totalAllocation.sub(usdcDeposits.add(usdtDeposits));
  const usdtReturn = returns.mul(usdtDeposits).div(usdcDeposits.add(usdtDeposits));
  const usdtExcess = vaultUsdtAlloction.sub(usdtDeposits).sub(usdtReturn);

  const swapAmountInUsdt = usdtExcess;
  const swapAmountOutUsdc = 0;
  const _swapUsdc = false;
  const _minUsdc = 0;
  const _minUsdt = 0;

  await stableVault
    .connect(multisig)
    .removeLiquidity(_minUsdc, _minUsdt, swapAmountInUsdt, swapAmountOutUsdc, _swapUsdc);

  const vaultUsdcBalance = (await usdc.balanceOf(stableVault.address)).div(1e6);
  const vaultUsdtBalance = (await usdt.balanceOf(stableVault.address)).div(1e6);
  console.log('Vault USDC balance', vaultUsdcBalance.toString());
  console.log('Vault USDT balance', vaultUsdtBalance.toString());
  console.log('----------------------');

  ////////////////////////////////////////////////////
  ///////             Vault & Pools            ///////
  ////////////////////////////////////////////////////

  const vault = await ethers.getContractAt('Vault', Deployments.mainnet.vault);
  const weth = await getWETH();

  await vault.connect(multisig).nextPhase();
  await vault.connect(multisig).wrapEth();

  for (let i = 0; i < poolAddresses.length; i++) {
    const poolAddress = poolAddresses[i];
    const isSushiPool = sushiPools.includes(poolAddress);
    const pool = isSushiPool
      ? await ethers.getContractAt('SushiPool', poolAddress)
      : await ethers.getContractAt('UniPool', poolAddress);

    const tokenAddress = await pool.token();
    const token = await getERC20(tokenAddress);
    const pairAddress = await pool.pair();
    const pair = await getERC20(pairAddress);

    const wethBalance = await weth.balanceOf(vault.address);
    const wethToDeploy = wethBalance.div(poolAddresses.length - i);
    const tokenDepositAmount = await token.balanceOf(poolAddress);

    await vault.connect(multisig).pairLiquidityPool(poolAddress, wethToDeploy, tokenDepositAmount, 0, 0);
    const remainingToken = await token.balanceOf(poolAddress);
    const poolSupply = await pool.totalSupply();
    console.log(await token.symbol(), 'pool paired');
    console.log('-- owns ', (await pair.balanceOf(poolAddress)).toString(), 'LP Tokens');
    console.log('-- ', poolSupply.sub(remainingToken).mul(100).div(poolSupply).toString(), '% deployed');
  }

  await ethers.provider.send('evm_increaseTime', [2592000]);

  for (let i = 0; i < poolAddresses.length; i++) {
    const poolAddress = poolAddresses[i];
    const isSushiPool = sushiPools.includes(poolAddress);
    const pool = isSushiPool
      ? await ethers.getContractAt('SushiPool', poolAddress)
      : await ethers.getContractAt('UniPool', poolAddress);
    const tokenAddress = await pool.token();
    const token = await getERC20(tokenAddress);

    await vault.connect(multisig).unpairLiquidityPool(poolAddress, 0, 0);

    const tokenBalanceFinal = await token.balanceOf(pool.address);
    console.log('unpairing', await token.symbol(), 'pool');
    console.log('-- returns: ', tokenBalanceFinal.sub(await pool.totalSupply()).toString());
  }

  await vault.connect(multisig).nextPhase();
  await vault.connect(multisig).unwrapEth();
  const ethBalanceFinal = await ethers.provider.getBalance(vault.address);

  console.log(
    'final eth returns',
    ethBalanceFinal.toString(),
    'on initial deposits of',
    (await vault.totalSupply()).toString(),
  );
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
