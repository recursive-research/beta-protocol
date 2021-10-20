import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import {
  IMasterChef,
  Vault,
  ERC20,
  IMasterChefV2,
  Pool,
  PoolV2Mock,
  IWETH,
  IERC20__factory,
  IUniswapV2Router02__factory,
} from '../typechain';
import {
  deployVault,
  deployPool,
  getERC20,
  getTokens,
  getMasterChef,
  getMasterChefV2,
  deployPoolV2,
  getWETH,
} from './utils';
import { Addresses, Contracts, getMasterChefPid, getSushiRewarder, Tokens } from './constants';

describe('Rift Pool Unit tests', () => {
  const fixedRate = BigNumber.from('10');
  const invalidFixedRate = BigNumber.from('2000');

  const ethDepositAmount = ethers.utils.parseEther('1');
  const tokenDepositAmount = ethers.utils.parseEther('1');

  const feeTo = Addresses.zero;
  const feeAmount = BigNumber.from(0);

  let admin: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  let weth: IWETH;
  let token: ERC20;
  let masterChef: IMasterChef;
  let masterChefV2: IMasterChefV2;

  let vault: Vault;
  let pool: Pool;
  let poolV2: PoolV2Mock;

  before(async () => {
    // account setup
    const signers: SignerWithAddress[] = await ethers.getSigners();

    [admin, alice, bob] = signers;

    // external contract setup
    weth = await getWETH();
    masterChef = await getMasterChef();
    masterChefV2 = await getMasterChefV2();
  });

  describe('Deployment', async () => {
    beforeEach(async () => {
      token = await getERC20(Tokens.aave);
      vault = await deployVault(admin, feeTo, feeAmount);
      pool = await deployPool(admin, vault, token, fixedRate);
    });

    it('should correctly assign token metadata', async () => {
      const tokenName = await token.name();
      const tokenSymbol = await token.symbol();

      expect(await pool.name()).to.eq('Rift ' + tokenName + ' Pool V1');
      expect(await pool.symbol()).to.eq('rp' + tokenSymbol + 'v1');
    });

    it('should mint no tokens on deployment', async () => {
      expect(await pool.totalSupply()).to.eq(0);
    });

    it('should store metadata on deployment', async () => {
      expect(await pool.vault()).to.eq(vault.address);
      expect(await pool.token()).to.eq(token.address);
      expect(await pool.fixedRate()).to.eq(fixedRate);
    });

    it('should reject deployment with invalid fixed rate', async () => {
      await expect(deployPool(admin, vault, token, invalidFixedRate, true)).to.be.revertedWith('Invalid fixed rate');
    });

    it('should reject deployment with invalid sushi master chef pid', async () => {
      token = await getERC20(Tokens.yfi);
      await expect(
        vault.deployPool(token.address, getSushiRewarder(token.address), 0, fixedRate, false),
      ).to.be.revertedWith('invalid pid mapping');
    });

    it('should reject deployment with invalid sushi master chef v2 pid', async () => {
      token = await getERC20(Tokens.alcx);
      await expect(
        vault.deployPool(token.address, getSushiRewarder(token.address), 1, fixedRate, false),
      ).to.be.revertedWith('invalid pid mapping');
    });
  });

  describe('Phase Zero', async () => {
    beforeEach(async () => {
      token = await getERC20(Tokens.aave);
      vault = await deployVault(admin, feeTo, feeAmount);
      pool = await deployPool(admin, vault, token, fixedRate);
    });

    it('should reject withdraws', async () => {
      await expect(pool.connect(alice).withdrawToken(Addresses.zero)).to.be.revertedWith('Invalid Phase function');
    });

    describe('Deposits', async () => {
      it('should mint pool staking tokens on token deposit', async () => {
        await getTokens(alice, token, tokenDepositAmount);
        await token.connect(alice).approve(pool.address, tokenDepositAmount);

        await pool.connect(alice).depositToken(tokenDepositAmount);

        expect(await pool.balanceOf(alice.address)).to.eq(tokenDepositAmount);
        expect(await token.balanceOf(pool.address)).to.eq(tokenDepositAmount);
        expect(await pool.totalSupply()).to.eq(tokenDepositAmount);
      });

      it('should emit event on token deposit', async () => {
        await getTokens(alice, token, tokenDepositAmount);
        await token.connect(alice).approve(pool.address, tokenDepositAmount);

        await expect(pool.connect(alice).depositToken(tokenDepositAmount))
          .to.emit(pool, 'Deposit')
          .withArgs(alice.address, tokenDepositAmount);
      });
    });
  });

  describe('Phase One', async () => {
    describe('Basic Token, no sushi rewards', async () => {
      beforeEach(async () => {
        token = await getERC20(Tokens.aave);
        vault = await deployVault(admin, feeTo, feeAmount);
        pool = await deployPool(admin, vault, token, fixedRate);

        await getTokens(alice, token, tokenDepositAmount);
        await token.connect(alice).approve(pool.address, tokenDepositAmount);
        await pool.connect(alice).depositToken(tokenDepositAmount);

        await vault.connect(alice).depositEth({ value: ethDepositAmount });

        await vault.nextPhase();
        await vault.wrapEth();
      });

      it('should reject deposits', async () => {
        await expect(pool.connect(alice).depositToken(tokenDepositAmount)).to.be.revertedWith('Invalid Phase function');
      });

      it('should reject withdraws', async () => {
        await expect(pool.connect(alice).withdrawToken(Addresses.zero)).to.be.revertedWith('Invalid Phase function');
      });

      it('should reject pairLiquidity calls from non-vault', async () => {
        await expect(pool.pairLiquidity(ethDepositAmount, tokenDepositAmount, 1, 1)).to.be.revertedWith('Only Vault');
      });

      it('should reject unpairLiquidity calls from non-vault', async () => {
        await expect(pool.unpairLiquidity(1, 1)).to.be.revertedWith('Only Vault');
      });

      it('should pair LP tokens for token-eth', async () => {
        await vault.pairLiquidityPool(token.address, ethDepositAmount, tokenDepositAmount, 1, 1);
        const pair = IERC20__factory.connect(await pool.pair(), ethers.provider);
        const lpTokensReceived = await pool.lpTokenBalance();

        expect(await pair.balanceOf(pool.address)).to.eq(lpTokensReceived);
      });

      it('should withdraw token-weth and return weth to vault', async () => {
        const pair = IERC20__factory.connect(await pool.pair(), ethers.provider);
        await vault.pairLiquidityPool(token.address, ethDepositAmount, tokenDepositAmount, 1, 1);
        await vault.unpairLiquidityPool(token.address, 1, 1);

        expect(await pair.balanceOf(pool.address)).to.eq(0);
        expect(await weth.balanceOf(pool.address)).to.eq(0);
      });

      it('should return sufficent token to cover fixed rate after trades', async () => {
        await vault.pairLiquidityPool(token.address, ethDepositAmount, tokenDepositAmount, 1, 1);
        await getTokens(bob, token, tokenDepositAmount);
        const sushiRouter = IUniswapV2Router02__factory.connect(Contracts.sushiRouter, bob);
        await token.connect(bob).approve(sushiRouter.address, tokenDepositAmount);
        await sushiRouter
          .connect(bob)
          .swapExactTokensForTokens(tokenDepositAmount, 0, [token.address, weth.address], bob.address, 2000000000);
        await vault.unpairLiquidityPool(token.address, 1, 1);
        expect(await weth.balanceOf(pool.address)).to.eq(0);
      });

      it('should swap weth for token when fixed rate is greater than returns', async () => {
        await vault.pairLiquidityPool(token.address, ethDepositAmount, tokenDepositAmount, 1, 1);
        const vaultWethBalance = await weth.balanceOf(vault.address);

        const sushiRouter = IUniswapV2Router02__factory.connect(Contracts.sushiRouter, bob);
        const wethTradeAmount = (await ethers.provider.getBalance(bob.address)).div(2);
        await weth.connect(bob).deposit({ value: wethTradeAmount });
        await weth.connect(bob).approve(sushiRouter.address, wethTradeAmount);
        await sushiRouter
          .connect(bob)
          .swapExactTokensForTokens(wethTradeAmount, 0, [weth.address, token.address], bob.address, 2000000000);

        await vault.unpairLiquidityPool(token.address, 1, 1);

        expect(await weth.balanceOf(vault.address)).to.eq(vaultWethBalance); // should be no more weth than initial
        expect(await weth.balanceOf(pool.address)).to.eq(0);
      });
    });

    describe('Token with Master Chef sushi rewards', async () => {
      beforeEach(async () => {
        token = await getERC20(Tokens.yfi);
        vault = await deployVault(admin, feeTo, feeAmount);
        pool = await deployPool(admin, vault, token, fixedRate);

        await getTokens(alice, token, tokenDepositAmount);
        await token.connect(alice).approve(pool.address, tokenDepositAmount);
        await pool.connect(alice).depositToken(tokenDepositAmount);

        await vault.connect(alice).depositEth({ value: ethDepositAmount });

        await vault.nextPhase();
        await vault.wrapEth();
      });

      it('should pair and update master chef balances for token-eth', async () => {
        await vault.pairLiquidityPool(token.address, ethDepositAmount, tokenDepositAmount, 1, 1);

        const lpTokensReceived = await pool.lpTokenBalance();
        const tokenInfo = await masterChef.userInfo(getMasterChefPid(token.address), pool.address);

        expect(tokenInfo.amount).to.eq(lpTokensReceived);
      });

      it('should withdraw token-weth from master chef and return weth to vault', async () => {
        await vault.pairLiquidityPool(token.address, ethDepositAmount, tokenDepositAmount, 1, 1);
        await vault.unpairLiquidityPool(token.address, 1, 1);

        const tokenInfo = await masterChef.userInfo(getMasterChefPid(token.address), pool.address);
        expect(tokenInfo.amount).to.eq(0);
        expect(await weth.balanceOf(pool.address)).to.eq(0);
      });
    });

    describe('Token with Master Chef V2 sushi rewards', async () => {
      beforeEach(async () => {
        token = await getERC20(Tokens.alcx);
        vault = await deployVault(admin, feeTo, feeAmount);
        pool = await deployPool(admin, vault, token, fixedRate);

        await getTokens(alice, token, tokenDepositAmount);
        await token.connect(alice).approve(pool.address, tokenDepositAmount);
        await pool.connect(alice).depositToken(tokenDepositAmount);

        await vault.connect(alice).depositEth({ value: ethDepositAmount });

        await vault.nextPhase();
        await vault.wrapEth();
      });

      it('should pair and update master chef v2 balances for token-eth', async () => {
        await vault.pairLiquidityPool(token.address, ethDepositAmount, tokenDepositAmount, 1, 1);

        const lpTokensReceived = await pool.lpTokenBalance();
        const tokenInfo = await masterChefV2.userInfo(getMasterChefPid(token.address), pool.address);

        expect(tokenInfo.amount).to.eq(lpTokensReceived);
      });

      it('should withdraw token-weth from master chef v2 and return weth to vault', async () => {
        await vault.pairLiquidityPool(token.address, ethDepositAmount, tokenDepositAmount, 1, 1);
        await vault.unpairLiquidityPool(token.address, 1, 1);

        const tokenInfo = await masterChef.userInfo(getMasterChefPid(token.address), pool.address);
        expect(tokenInfo.amount).to.eq(0);
        expect(await weth.balanceOf(pool.address)).to.eq(0);
      });
    });

    describe('Edge cases', async () => {
      it('should make no swap if token amount returned is exactly the token amount deposited', async () => {
        const fixedRateZero = BigNumber.from(0);
        const tokenDepositMinimal = BigNumber.from(100);
        token = await getERC20(Tokens.aave);
        vault = await deployVault(admin, feeTo, feeAmount);
        pool = await deployPool(admin, vault, token, fixedRateZero);

        await getTokens(alice, token, tokenDepositMinimal);
        await token.connect(alice).approve(pool.address, tokenDepositMinimal);
        await pool.connect(alice).depositToken(tokenDepositMinimal);

        await vault.connect(alice).depositEth({ value: ethDepositAmount });

        await vault.nextPhase();
        await vault.wrapEth();

        await vault.pairLiquidityPool(token.address, ethDepositAmount, tokenDepositMinimal, 0, 0);

        const sushiRouter = IUniswapV2Router02__factory.connect(Contracts.sushiRouter, bob);
        const tokenTradeAmount = ethers.utils.parseEther('8000');
        await getTokens(bob, token, tokenTradeAmount);
        await token.connect(bob).approve(sushiRouter.address, tokenTradeAmount);
        await sushiRouter
          .connect(bob)
          .swapExactTokensForTokens(tokenTradeAmount, 0, [token.address, weth.address], bob.address, 2000000000);

        await vault.unpairLiquidityPool(token.address, 0, 0);
        expect(await weth.balanceOf(pool.address)).to.eq(0);
        expect(await token.balanceOf(pool.address)).to.eq(tokenDepositMinimal);
      });
    });
  });

  describe('Phase Two', async () => {
    beforeEach(async () => {
      token = await getERC20(Tokens.yfi);
      vault = await deployVault(admin, feeTo, feeAmount);
      pool = await deployPool(admin, vault, token, fixedRate);

      await getTokens(alice, token, tokenDepositAmount);
      await token.connect(alice).approve(pool.address, tokenDepositAmount);
      await pool.connect(alice).depositToken(tokenDepositAmount);

      await vault.connect(alice).depositEth({ value: ethDepositAmount });

      await vault.nextPhase();
      await vault.wrapEth();

      await vault.pairLiquidityPool(token.address, ethDepositAmount, tokenDepositAmount, 1, 1);
      await vault.unpairLiquidityPool(token.address, 1, 1);

      await vault.nextPhase();
      await vault.unwrapEth();
    });

    it('should reject deposits', async () => {
      await expect(pool.connect(alice).depositToken(tokenDepositAmount)).to.be.revertedWith('Invalid Phase function');
    });

    it('should reject withdraw when user has no balance', async () => {
      await expect(pool.connect(bob).withdrawToken(Addresses.zero)).to.be.revertedWith('User has no balance');
    });

    it('should allow users to withdraw their balance', async () => {
      const tokenReturn = await token.balanceOf(pool.address);
      expect(tokenReturn).to.be.gt(tokenDepositAmount);

      await pool.connect(alice).withdrawToken(Addresses.zero);
      expect(await token.balanceOf(alice.address)).to.eq(tokenReturn);
      expect(await pool.balanceOf(alice.address)).to.eq(0);
      expect(await token.balanceOf(pool.address)).to.eq(0);
    });

    it('should emit event when user withdraws', async () => {
      const tokenReturn = await token.balanceOf(pool.address);
      await expect(pool.connect(alice).withdrawToken(Addresses.zero))
        .to.emit(pool, 'Withdraw')
        .withArgs(alice.address, tokenReturn);
    });

    it('should allow users to migrate their liquidity to v2', async () => {
      const tokenReturn = await token.balanceOf(pool.address);
      poolV2 = await deployPoolV2(admin, token.address);

      await pool.connect(alice).withdrawToken(poolV2.address);

      expect(await pool.balanceOf(alice.address)).to.eq(0);
      expect(await token.balanceOf(pool.address)).to.eq(0);
      expect(await token.balanceOf(poolV2.address)).to.eq(tokenReturn);
      expect(await poolV2.balanceOf(alice.address)).to.eq(tokenReturn);
    });

    it('should emit event when user migrates to v2', async () => {
      const tokenReturn = await token.balanceOf(pool.address);
      poolV2 = await deployPoolV2(admin, token.address);
      await expect(pool.connect(alice).withdrawToken(poolV2.address))
        .to.emit(pool, 'Migration')
        .withArgs(alice.address, tokenReturn);
    });
  });
});
