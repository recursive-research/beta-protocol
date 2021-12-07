import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ethers } from 'hardhat';
import { Addresses, Contracts, Deployments, Tokens } from '../../constants';
import { getERC20, getTokens, getWETH, mineBlocks, impersonateAccount } from '../../test/utils';
import { IUniswapV2Router02__factory } from '../../typechain';

async function main() {
  // get signers
  const multisig = await ethers.getSigner(Addresses.gnosis_beta);
  await impersonateAccount(multisig.address);

  const signers: SignerWithAddress[] = await ethers.getSigners();
  const [, alice, bob, charlie, dave, rando, rando2, rando3] = signers;
  await alice.sendTransaction({ to: multisig.address, value: ethers.utils.parseEther('100') });

  // get contracts
  const weth = await getWETH();
  const alcx = await getERC20(Tokens.alcx);
  const ftm = await getERC20(Tokens.ftm);
  const inj = await getERC20(Tokens.inj);

  const vault = await ethers.getContractAt('Vault', Deployments.mainnet.vault);
  const poolAlcx = await ethers.getContractAt('SushiPool', Deployments.mainnet.alcxPool);
  const poolInj = await ethers.getContractAt('SushiPool', Deployments.mainnet.injPool);
  const poolFtm = await ethers.getContractAt('SushiPool', Deployments.mainnet.ftmPool);

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
  await vault.connect(multisig).nextPhase();
  await vault.connect(multisig).wrapEth();

  // pair liquidity
  console.log('Pairing Liquidity...');
  // -- deposit max amount of WETH as it will return any excess, don't set min amounts because we're
  // -- --  not afraid of being frontrun in a sandbox
  let wethBalance = await weth.balanceOf(vault.address);
  await vault.connect(multisig).pairLiquidityPool(poolAlcx.address, wethBalance, alcxDepositAmount, 0, 0);
  wethBalance = await weth.balanceOf(vault.address);
  await vault.connect(multisig).pairLiquidityPool(poolInj.address, wethBalance, injDepositAmount, 0, 0);
  wethBalance = await weth.balanceOf(vault.address);
  await vault.connect(multisig).pairLiquidityPool(poolFtm.address, wethBalance, ftmDepositAmount, 0, 0);

  // Collecting swap fees
  console.log('Collecting swap fees...');
  const sushiRouter = IUniswapV2Router02__factory.connect(Contracts.sushiRouter, rando);

  await weth.connect(rando).approve(sushiRouter.address, ethers.constants.MaxUint256);
  await weth.connect(rando2).approve(sushiRouter.address, ethers.constants.MaxUint256);
  await weth.connect(rando3).approve(sushiRouter.address, ethers.constants.MaxUint256);

  // Swap $50m of ETH for ALCX
  let ethTradeAmount = ethers.utils.parseEther('9999'); // ~$45mm (each account has 10000 ETH)
  await weth.connect(rando).deposit({ value: ethTradeAmount });
  await sushiRouter
    .connect(rando)
    .swapExactTokensForTokens(ethTradeAmount, 0, [weth.address, alcx.address], rando.address, 2000000000);

  // Swap $400k ETH for INJ (almost the entire pool)
  ethTradeAmount = ethers.utils.parseEther('100'); // ~400k
  await weth.connect(rando2).deposit({ value: ethTradeAmount });
  await sushiRouter
    .connect(rando2)
    .swapExactTokensForTokens(ethTradeAmount, 0, [weth.address, inj.address], rando.address, 2000000000);

  // swap $12m ETH for FTM
  ethTradeAmount = ethers.utils.parseEther('3000'); // ~$12m
  await weth.connect(rando3).deposit({ value: ethTradeAmount });
  await sushiRouter
    .connect(rando3)
    .swapExactTokensForTokens(ethTradeAmount, 0, [weth.address, ftm.address], rando.address, 2000000000);

  // fast forward ~30 days to simulate timestamp increase
  // and mine ~200000 blocks to receive sushi rewards (this took too long)
  await mineBlocks(2000);
  await ethers.provider.send('evm_increaseTime', [2592000]);

  // Unpair liquidity pools. No need to set min amounts in sandbox
  console.log('Unpairing liquidity...');
  console.log('----------------------');
  await vault.connect(multisig).unpairLiquidityPool(poolAlcx.address, 0, 0);
  await vault.connect(multisig).unpairLiquidityPool(poolInj.address, 0, 0);
  await vault.connect(multisig).unpairLiquidityPool(poolFtm.address, 0, 0);

  // Last phase
  await vault.connect(multisig).nextPhase();

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
