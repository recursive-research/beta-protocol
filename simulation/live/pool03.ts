import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ethers } from 'hardhat';
import { Addresses, Contracts, Deployments } from '../../constants';
import { getERC20, getTokens, getWETH, impersonateAccount } from '../../test/utils';
import { IUniswapV2Router02__factory } from '../../typechain';

const sushiPools = [
  Deployments.mainnet.alcxPool,
  Deployments.mainnet.ftmPool,
  Deployments.mainnet.injPool,
  Deployments.mainnet.pondPool,
];

async function main() {
  const poolAddress = Deployments.mainnet.rampPool;
  const tokenDepositAmount = ethers.utils.parseEther('1000000');
  const wethTradeAmount = ethers.utils.parseEther('500');

  const multisig = await ethers.getSigner(Addresses.gnosis_beta);
  await impersonateAccount(multisig.address);

  const signers: SignerWithAddress[] = await ethers.getSigners();
  const [, alice, bob, rando] = signers;
  await alice.sendTransaction({ to: multisig.address, value: ethers.utils.parseEther('100') });

  const vault = await ethers.getContractAt('Vault', Deployments.mainnet.vault);
  const weth = await getWETH();

  console.log('-----------------------------------------------------');
  console.log('verifying pool at:', poolAddress);
  const isSushiPool = sushiPools.includes(poolAddress);

  const pool = isSushiPool
    ? await ethers.getContractAt('SushiPool', poolAddress)
    : await ethers.getContractAt('UniPool', poolAddress);
  const tokenAddress = await pool.token();
  const token = await getERC20(tokenAddress);

  console.log('---              sushi pool?:', isSushiPool);
  console.log('---              pool token:', tokenAddress);
  console.log('--- vault map pool to token:', await vault.poolToToken(poolAddress));
  console.log('---            pair address:', await pool.pair());
  console.log('---                   vault:', await pool.vault());
  console.log('---                migrator:', await pool.migrator());

  console.log('Making deposits...');
  const ethDepositBob = ethers.utils.parseEther('4000'); // ~$17mm
  await vault.connect(bob).depositEth({ value: ethDepositBob });
  const ethDepositAmount = await ethers.provider.getBalance(vault.address);

  await getTokens(alice, token, tokenDepositAmount);
  await token.connect(alice).approve(pool.address, ethers.constants.MaxUint256);
  await pool.connect(alice).depositToken(tokenDepositAmount);

  console.log('Moving contracts to next phase...');
  await vault.connect(multisig).nextPhase();
  await vault.connect(multisig).wrapEth();

  console.log('Pairing Liquidity...');
  const wethBalance = await weth.balanceOf(vault.address);
  await vault.connect(multisig).pairLiquidityPool(pool.address, wethBalance, tokenDepositAmount, 0, 0);

  console.log('Collecting swap fees...');
  const router = isSushiPool
    ? IUniswapV2Router02__factory.connect(Contracts.sushiRouter, rando)
    : IUniswapV2Router02__factory.connect(Contracts.uniswapRouter, rando);
  await weth.connect(rando).deposit({ value: wethTradeAmount });
  await weth.connect(rando).approve(router.address, ethers.constants.MaxUint256);
  await router
    .connect(rando)
    .swapExactTokensForTokens(wethTradeAmount, 0, [weth.address, token.address], rando.address, 2000000000);

  // await mineBlocks(2000);
  await ethers.provider.send('evm_increaseTime', [2592000]);

  console.log('Unpairing liquidity...');
  await vault.connect(multisig).unpairLiquidityPool(pool.address, 0, 0);
  await vault.connect(multisig).nextPhase();

  const tokenBalanceFinal = await token.balanceOf(pool.address);
  const ethBalanceFinal = await weth.balanceOf(vault.address);

  console.log(
    'Final token returns:',
    tokenBalanceFinal.sub(tokenDepositAmount).toString(),
    'on initial deposit of: ',
    tokenDepositAmount.toString(),
  );

  console.log(
    'Final ETH Returns:',
    ethBalanceFinal.sub(ethDepositAmount).toString(),
    'on initial deposit of: ',
    ethDepositAmount.toString(),
  );

  console.log('done!');
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
