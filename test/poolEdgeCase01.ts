import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import { Vault, ERC20, IMasterChefV2, Pool, IWETH, IUniswapV2Router02__factory } from '../typechain';
import { deployVault, deployPool, getERC20, getTokens, getWETH, getMasterChefV2 } from './utils';
import { Addresses, Contracts, getMasterChefPid, getWhale, Tokens } from './constants';

describe('Rift Pool Edge Cases - Large IL', () => {
  const fixedRate = BigNumber.from('10');
  const maxEth = ethers.utils.parseEther('50');

  const ethDepositAmount = ethers.utils.parseEther('30');
  const alcxDepositAmount = ethers.utils.parseEther('20');

  let admin: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  let weth: IWETH;
  let alcx: ERC20;
  let masterChefV2: IMasterChefV2;

  let vault: Vault;
  let alcxPool: Pool;

  before(async () => {
    // account setup
    const signers: SignerWithAddress[] = await ethers.getSigners();

    [admin, alice, bob] = signers;

    // external contract setup
    weth = await getWETH();
    alcx = await getERC20(Tokens.alcx);

    masterChefV2 = await getMasterChefV2();

    // rift contract setup
    vault = await deployVault(admin, fixedRate, maxEth);
    alcxPool = await deployPool(admin, vault, alcx);
  });

  describe('Deposit into Pool', async () => {
    it('should mint pool staking tokens on alcx deposit', async () => {
      await getTokens(alice, alcx, alcxDepositAmount);
      await alcx.connect(alice).approve(alcxPool.address, alcxDepositAmount);
      await alcxPool.connect(alice).depositToken(alcxDepositAmount);

      expect(await alcxPool.balanceOf(alice.address)).to.eq(alcxDepositAmount);
      expect(await alcx.balanceOf(alcxPool.address)).to.eq(alcxDepositAmount);
      expect(await alcxPool.totalSupply()).to.eq(alcxDepositAmount);
    });
  });

  describe('Deposit Eth', async () => {
    before(async () => {
      await vault.connect(alice).depositEth({ value: ethDepositAmount });
      await vault.nextPhase();
      await vault.wrapEth();
    });

    it('should pair and update master chef v2 balances for alcx-weth', async () => {
      await vault.pairLiquidityPool(alcxPool.address, alcxDepositAmount, 1, 1);

      const lpTokensReceived = await alcxPool.lpTokenBalance();
      const alcxInfo = await masterChefV2.userInfo(getMasterChefPid(alcx.address), alcxPool.address);

      expect(alcxInfo.amount).to.eq(lpTokensReceived);
    });
  });

  describe('Traders depress price of token', async () => {
    it('swap biiig alcx bags for ETH', async () => {
      const sushiRouter = IUniswapV2Router02__factory.connect(Contracts.sushiRouter, bob);
      const alcxTradeAmount = (await alcx.balanceOf(getWhale(alcx.address))).mul(9).div(10); // save some for the other tests

      await getTokens(bob, alcx, alcxTradeAmount);
      await alcx.connect(bob).approve(sushiRouter.address, alcxTradeAmount);
      await sushiRouter
        .connect(bob)
        .swapExactTokensForTokens(alcxTradeAmount, 0, [alcx.address, weth.address], bob.address, 2000000000);
    });
  });

  describe('Unpair Vaults Liquidity', async () => {
    it('should withdraw alcx-weth from master chef and return weth to vault', async () => {
      await vault.unpairLiquidityPool(alcxPool.address, 1, 1);

      const alcxInfo = await masterChefV2.userInfo(getMasterChefPid(alcx.address), alcxPool.address);
      expect(alcxInfo.amount).to.eq(0);
      expect(await weth.balanceOf(alcxPool.address)).to.eq(0);
    });
  });

  describe('Withdraw', async () => {
    before(async () => {
      await vault.unwrapEth();
      await vault.nextPhase();
    });
    it('should allow users to withdraw original deposits after large IL', async () => {
      expect(await weth.balanceOf(vault.address)).to.eq(0);

      await vault.connect(alice).withdrawEth(Addresses.zero);

      expect(await ethers.provider.getBalance(vault.address)).to.eq(0);
    });
  });
});
