import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ethers } from 'hardhat';
import { BigNumber as BN } from 'ethers';
import { Contracts, Tokens } from '../constants';
import { deployVault, deploySushiPool, getERC20, getTokens, getWETH, mineBlocks } from '../test/utils';
import { IUniswapV2Router02__factory } from '../typechain';

async function main() {
  // constants
  const fixedRate = BN.from(10); // 1% APY for DAOs

  // get signers
  const signers: SignerWithAddress[] = await ethers.getSigners();
  const [admin, alice, bob, charlie, dave, rando] = signers;

  // get contracts
  const weth = await getWETH();
  const alcx = await getERC20(Tokens.alcx);
  const ftm = await getERC20(Tokens.ftm);
  const inj = await getERC20(Tokens.inj);

  // deploy contracts and setup
  console.log('Deploying contracts...');
  const vault = await deployVault(admin);
  const poolAlcx = await deploySushiPool(admin, vault, alcx, fixedRate);
  const poolInj = await deploySushiPool(admin, vault, inj, fixedRate);
  const poolFtm = await deploySushiPool(admin, vault, ftm, fixedRate);

  await vault.registerPool(poolAlcx.address);
  await vault.registerPool(poolInj.address);
  await vault.registerPool(poolFtm.address);

  // acquire tokens and deposit
  console.log('Making deposits...');
  const ethDepositAmount = ethers.utils.parseEther('4000'); // ~$17mm
  const alcxDepositAmount = ethers.utils.parseEther('2000'); // ~$1mm
  const injDepositAmount = ethers.utils.parseEther('500000'); // ~$10mm
  const ftmDepositAmount = ethers.utils.parseEther('2000000'); // ~$6mm

  await getTokens(bob, alcx, alcxDepositAmount);
  await getTokens(charlie, inj, injDepositAmount);
  await getTokens(dave, ftm, ftmDepositAmount);

  await alcx.connect(bob).approve(poolAlcx.address, ethers.constants.MaxUint256);
  await inj.connect(charlie).approve(poolInj.address, ethers.constants.MaxUint256);
  await ftm.connect(dave).approve(poolFtm.address, ethers.constants.MaxUint256);

  await vault.connect(alice).depositEth({ value: ethDepositAmount });
  await poolAlcx.connect(bob).depositToken(alcxDepositAmount);
  await poolInj.connect(charlie).depositToken(injDepositAmount);
  await poolFtm.connect(dave).depositToken(ftmDepositAmount);

  // move to next phase
  console.log('Moving contracts to next phase...');
  await vault.nextPhase();
  await vault.wrapEth();

  // pair liquidity
  console.log('Pairing Liquidity...');
  // -- deposit max amount of WETH as it will return any excess, don't set min amounts because we're
  // -- --  not afraid of being frontrun in a sandbox
  let wethBalance = await weth.balanceOf(vault.address);
  await vault.pairLiquidityPool(poolAlcx.address, wethBalance, alcxDepositAmount, 0, 0);
  wethBalance = await weth.balanceOf(vault.address);
  await vault.pairLiquidityPool(poolInj.address, wethBalance, injDepositAmount, 0, 0);
  wethBalance = await weth.balanceOf(vault.address);
  await vault.pairLiquidityPool(poolFtm.address, wethBalance, ftmDepositAmount, 0, 0);

  // Collecting swap fees
  console.log('Collecting swap fees...');
  const sushiRouter = IUniswapV2Router02__factory.connect(Contracts.sushiRouter, rando);
  let wethTradeAmount = ethers.utils.parseEther('1000'); // ~$5mm
  await weth.connect(rando).deposit({ value: wethTradeAmount });

  await weth.connect(rando).approve(sushiRouter.address, ethers.constants.MaxUint256);
  await alcx.connect(rando).approve(sushiRouter.address, ethers.constants.MaxUint256);
  await inj.connect(rando).approve(sushiRouter.address, ethers.constants.MaxUint256);
  await ftm.connect(rando).approve(sushiRouter.address, ethers.constants.MaxUint256);

  // -- ALCX: ~$5mm of volume per day, so we want ~$150mm of volume over 30 days
  for (let i = 0; i < 30; i++) {
    if (i % 2 == 0) {
      const randoBalance = await weth.balanceOf(rando.address);
      await sushiRouter
        .connect(rando)
        .swapExactTokensForTokens(randoBalance, 0, [weth.address, alcx.address], rando.address, 2000000000);
    } else {
      const randoBalance = await alcx.balanceOf(rando.address);
      await sushiRouter
        .connect(rando)
        .swapExactTokensForTokens(randoBalance, 0, [alcx.address, weth.address], rando.address, 2000000000);
    }
  }

  // -- INJ: ~$100k volume per day, so we want ~$3m of volume over 30 days
  wethTradeAmount = ethers.utils.parseEther('25'); // ~$100k
  wethBalance = await weth.balanceOf(rando.address);
  await weth.connect(rando).withdraw(wethBalance.sub(wethTradeAmount));
  for (let i = 0; i < 30; i++) {
    if (i % 2 == 0) {
      const randoBalance = await weth.balanceOf(rando.address);
      await sushiRouter
        .connect(rando)
        .swapExactTokensForTokens(randoBalance, 0, [weth.address, inj.address], rando.address, 2000000000);
    } else {
      const randoBalance = await inj.balanceOf(rando.address);
      await sushiRouter
        .connect(rando)
        .swapExactTokensForTokens(randoBalance, 0, [inj.address, weth.address], rando.address, 2000000000);
    }
  }

  // -- FTM: ~$5m volume per day, so we want ~$150m of volume over 30 days
  wethTradeAmount = ethers.utils.parseEther('1000'); // ~$5m
  wethBalance = await weth.balanceOf(rando.address);
  await weth.connect(rando).deposit({ value: wethTradeAmount.sub(wethBalance) });
  for (let i = 0; i < 30; i++) {
    if (i % 2 == 0) {
      const randoBalance = await weth.balanceOf(rando.address);
      await sushiRouter
        .connect(rando)
        .swapExactTokensForTokens(randoBalance, 0, [weth.address, ftm.address], rando.address, 2000000000);
    } else {
      const randoBalance = await ftm.balanceOf(rando.address);
      await sushiRouter
        .connect(rando)
        .swapExactTokensForTokens(randoBalance, 0, [ftm.address, weth.address], rando.address, 2000000000);
    }
  }

  // fast forward ~30 days to simulate timestamp increase
  // and mine ~200000 blocks to receive sushi rewards (this took too long)
  await mineBlocks(2000);
  await ethers.provider.send('evm_increaseTime', [2592000]);

  // Unpair liquidity pools. No need to set min amounts in sandbox
  console.log('Unpairing liquidity...');
  console.log('----------------------');
  await vault.unpairLiquidityPool(poolAlcx.address, 0, 0);
  await vault.unpairLiquidityPool(poolInj.address, 0, 0);
  await vault.unpairLiquidityPool(poolFtm.address, 0, 0);

  // Last phase
  await vault.nextPhase();

  const alcxBalanceFinal = await alcx.balanceOf(poolAlcx.address);
  const injBalanceFinal = await inj.balanceOf(poolInj.address);
  const ftmBalanceFinal = await ftm.balanceOf(poolFtm.address);
  const ethBalanceFinal = await weth.balanceOf(vault.address);

  console.log(
    'Final ALCX Returns:',
    alcxBalanceFinal.sub(alcxDepositAmount).toString(),
    'on initial deposit of: ',
    alcxDepositAmount.toString(),
  );
  console.log(
    'Final INJ Returns:',
    injBalanceFinal.sub(injDepositAmount).toString(),
    'on initial deposit of: ',
    injDepositAmount.toString(),
  );
  console.log(
    'Final FTM Returns:',
    ftmBalanceFinal.sub(ftmDepositAmount).toString(),
    'on initial deposit of: ',
    ftmDepositAmount.toString(),
  );
  console.log(
    'Final ETH Returns:',
    ethBalanceFinal.sub(ethDepositAmount).toString(),
    'on initial deposit of: ',
    ethDepositAmount.toString(),
  );
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
