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
import { Addresses, Contracts, getMasterChefPid, getWhale, Tokens } from './constants';

describe('Rift Pool Unit tests', () => {
  const fixedRate = BigNumber.from('10');
  const maxEth = ethers.utils.parseEther('10');

  const ethDepositAmount = ethers.utils.parseEther('1');
  const tokenDepositAmount = ethers.utils.parseEther('1');

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
      vault = await deployVault(admin, maxEth);
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

    it('should store vault and token address on deployment', async () => {
      expect(await pool.vault()).to.eq(vault.address);
      expect(await pool.token()).to.eq(token.address);
    });
  });

  describe('Phase Zero', async () => {
    beforeEach(async () => {
      token = await getERC20(Tokens.aave);
      vault = await deployVault(admin, maxEth);
      pool = await deployPool(admin, vault, token, fixedRate);
    });

    it('should reject deposits when amount exceeds balance', async () => {
      await expect(pool.connect(alice).depositToken(tokenDepositAmount)).to.be.revertedWith(
        'SafeMath: subtraction overflow',
      );
    });

    it('should reject withdraws', async () => {
      await expect(pool.connect(alice).withdrawToken(Addresses.zero)).to.be.revertedWith(
        'Cannot execute this function during current phase',
      );
    });

    describe('Deposits', async () => {
      it('should mint pool staking tokens on tokenMC deposit', async () => {
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
        vault = await deployVault(admin, maxEth);
        pool = await deployPool(admin, vault, token, fixedRate);

        await getTokens(alice, token, tokenDepositAmount);
        await token.connect(alice).approve(pool.address, tokenDepositAmount);
        await pool.connect(alice).depositToken(tokenDepositAmount);

        await vault.connect(alice).depositEth({ value: ethDepositAmount });

        await vault.nextPhase();
        await vault.wrapEth();
      });

      it('should reject deposits', async () => {
        await expect(pool.connect(alice).depositToken(tokenDepositAmount)).to.be.revertedWith(
          'Cannot execute this function during current phase',
        );
      });

      it('should reject withdraws', async () => {
        await expect(pool.connect(alice).withdrawToken(Addresses.zero)).to.be.revertedWith(
          'Cannot execute this function during current phase',
        );
      });

      it('should reject pairLiquidity calls from non-vault', async () => {
        await expect(pool.pairLiquidity(ethDepositAmount, tokenDepositAmount, 1, 1)).to.be.revertedWith('Only Vault');
      });

      it('should reject unpairLiquidity calls from non-vault', async () => {
        await expect(pool.unpairLiquidity(1, 1)).to.be.revertedWith('Only Vault');
      });

      it('should pair hold LP tokens for token-eth', async () => {
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

      it('should not make swap when pool can return fixed rate exactly', async () => {
        const fixedReturn = ethers.BigNumber.from(779579815);
        await vault.pairLiquidityPool(token.address, ethDepositAmount, tokenDepositAmount, 1, 1);
        await getTokens(pool, weth, fixedReturn);
        await vault.unpairLiquidityPool(token.address, 1, 1);
      });

      it('should swap token for weth when fixed rate is greater than returns', async () => {
        const sushiRouter = IUniswapV2Router02__factory.connect(Contracts.sushiRouter, bob);
        const tokenTradeAmount = (await token.balanceOf(getWhale(token.address))).div(2); // save some for the other tests

        await vault.pairLiquidityPool(token.address, ethDepositAmount, tokenDepositAmount, 1, 1);
        await getTokens(bob, token, tokenTradeAmount);
        await token.connect(bob).approve(sushiRouter.address, tokenTradeAmount);

        await sushiRouter
          .connect(bob)
          .swapExactTokensForTokens(tokenTradeAmount, 0, [token.address, weth.address], bob.address, 2000000000);

        await vault.unpairLiquidityPool(token.address, 1, 1);
        expect(await weth.balanceOf(pool.address)).to.eq(0);
        expect(await token.balanceOf(pool.address)).to.eq(0);
      });
    });

    describe('Token with Master Chef sushi rewards', async () => {
      beforeEach(async () => {
        token = await getERC20(Tokens.yfi);
        vault = await deployVault(admin, maxEth);
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
        vault = await deployVault(admin, maxEth);
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
  });

  describe('Phase Two', async () => {
    beforeEach(async () => {
      token = await getERC20(Tokens.yfi);
      vault = await deployVault(admin, maxEth);
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
      await expect(pool.connect(alice).depositToken(tokenDepositAmount)).to.be.revertedWith(
        'Cannot execute this function during current phase',
      );
    });

    it('should reject withdraw when user has no balance', async () => {
      await expect(pool.connect(bob).withdrawToken(Addresses.zero)).to.be.revertedWith('User has no balance');
    });

    it('should allow users to view their withdrawable balance', async () => {
      const poolTokenBalance = await token.balanceOf(pool.address);
      expect(await pool.tokenShare(alice.address)).to.eq(poolTokenBalance);
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
