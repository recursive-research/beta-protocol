import { expect } from 'chai';
import hre, { ethers } from 'hardhat';
import { BigNumber } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import { Vault, ERC20, PoolV2Mock, IWETH, IERC20__factory, IUniswapV2Router02__factory, UniPool } from '../typechain';
import { deployVault, deployUniPool, getERC20, getTokens, deployPoolV2, getWETH } from './utils';
import { Addresses, Contracts, Tokens } from './constants';
import { Artifact } from 'hardhat/types';
import { deployContract } from 'ethereum-waffle';

describe('Rift Uniswap Pool Unit tests', () => {
  const fixedRate = BigNumber.from('10');
  const invalidFixedRate = BigNumber.from('2000');

  const ethDepositAmount = ethers.utils.parseEther('1');
  const tokenDepositAmount = ethers.utils.parseEther('1');

  let admin: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  let weth: IWETH;
  let token: ERC20;

  let vault: Vault;
  let pool: UniPool;
  let poolV2: PoolV2Mock;

  before(async () => {
    // account setup
    const signers: SignerWithAddress[] = await ethers.getSigners();

    [admin, alice, bob] = signers;

    // external contract setup
    weth = await getWETH();
  });

  describe('Deployment', async () => {
    beforeEach(async () => {
      token = await getERC20(Tokens.aave);
      vault = await deployVault(admin);
      pool = await deployUniPool(admin, vault, token, fixedRate);
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
      await expect(deployUniPool(admin, vault, token, invalidFixedRate)).to.be.revertedWith('Invalid fixed rate');
    });

    it('should reject deployment with invalid weth', async () => {
      const uniPoolArtifact: Artifact = await hre.artifacts.readArtifact('UniPool');
      await expect(
        deployContract(admin, uniPoolArtifact, [vault.address, token.address, fixedRate, Addresses.zero]),
      ).to.be.revertedWith('Invalid weth address');
    });

    it('should reject migrator update from non migrator', async () => {
      await expect(pool.connect(alice).updateMigrator(alice.address)).to.be.revertedWith('only migrator');
    });

    it('should allow migrator to update migrator', async () => {
      expect(await pool.migrator()).to.eq(admin.address);
      await pool.updateMigrator(alice.address);
      expect(await pool.migrator()).to.eq(alice.address);
    });
  });

  describe('Phase Zero', async () => {
    beforeEach(async () => {
      token = await getERC20(Tokens.aave);
      vault = await deployVault(admin);
      pool = await deployUniPool(admin, vault, token, fixedRate);
      await vault.registerPool(pool.address);
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
    describe('Basic Token', async () => {
      beforeEach(async () => {
        token = await getERC20(Tokens.aave);
        vault = await deployVault(admin);
        pool = await deployUniPool(admin, vault, token, fixedRate);
        await vault.registerPool(pool.address);

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

      it('should reject pairLiquidity calls from non-vault', async () => {
        await expect(pool.pairLiquidity(ethDepositAmount, tokenDepositAmount, 1, 1)).to.be.revertedWith('Only Vault');
      });

      it('should reject unpairLiquidity calls from non-vault', async () => {
        await expect(pool.unpairLiquidity(1, 1)).to.be.revertedWith('Only Vault');
      });

      it('should pair LP tokens for token-eth', async () => {
        await vault.pairLiquidityPool(pool.address, ethDepositAmount, tokenDepositAmount, 1, 1);
        const pair = IERC20__factory.connect(await pool.pair(), ethers.provider);
        const lpTokensReceived = await pool.lpTokenBalance();

        expect(await pair.balanceOf(pool.address)).to.eq(lpTokensReceived);
      });

      it('should withdraw token-weth and return weth to vault', async () => {
        const pair = IERC20__factory.connect(await pool.pair(), ethers.provider);
        await vault.pairLiquidityPool(pool.address, ethDepositAmount, tokenDepositAmount, 1, 1);
        await vault.unpairLiquidityPool(pool.address, 1, 1);

        expect(await pair.balanceOf(pool.address)).to.eq(0);
        expect(await weth.balanceOf(pool.address)).to.eq(0);
      });

      it('should return sufficent token to cover fixed rate after trades', async () => {
        await vault.pairLiquidityPool(pool.address, ethDepositAmount, tokenDepositAmount, 1, 1);
        await getTokens(bob, token, tokenDepositAmount);
        const uniswapRouter = IUniswapV2Router02__factory.connect(Contracts.uniswapRouter, bob);
        await token.connect(bob).approve(uniswapRouter.address, tokenDepositAmount);
        await uniswapRouter
          .connect(bob)
          .swapExactTokensForTokens(tokenDepositAmount, 0, [token.address, weth.address], bob.address, 2000000000);
        await vault.unpairLiquidityPool(pool.address, 1, 1);
        expect(await weth.balanceOf(pool.address)).to.eq(0);
      });

      it('should swap weth for token when fixed rate is greater than returns', async () => {
        await vault.pairLiquidityPool(pool.address, ethDepositAmount, tokenDepositAmount, 1, 1);
        const vaultWethBalance = await weth.balanceOf(vault.address);

        const uniswapRouter = IUniswapV2Router02__factory.connect(Contracts.uniswapRouter, bob);
        const wethTradeAmount = (await ethers.provider.getBalance(bob.address)).div(2);
        await weth.connect(bob).deposit({ value: wethTradeAmount });
        await weth.connect(bob).approve(uniswapRouter.address, wethTradeAmount);
        await uniswapRouter
          .connect(bob)
          .swapExactTokensForTokens(wethTradeAmount, 0, [weth.address, token.address], bob.address, 2000000000);

        await vault.unpairLiquidityPool(pool.address, 1, 1);

        expect(await weth.balanceOf(vault.address)).to.eq(vaultWethBalance); // should be no more weth than initial
        expect(await weth.balanceOf(pool.address)).to.eq(0);
      });
    });
  });

  describe('Phase Two', async () => {
    beforeEach(async () => {
      token = await getERC20(Tokens.yfi);
      vault = await deployVault(admin);
      pool = await deployUniPool(admin, vault, token, fixedRate);
      await vault.registerPool(pool.address);

      await getTokens(alice, token, tokenDepositAmount);
      await token.connect(alice).approve(pool.address, tokenDepositAmount);
      await pool.connect(alice).depositToken(tokenDepositAmount);

      await vault.connect(alice).depositEth({ value: ethDepositAmount });

      await vault.nextPhase();
      await vault.wrapEth();

      await vault.pairLiquidityPool(pool.address, ethDepositAmount, tokenDepositAmount, 1, 1);
      await vault.unpairLiquidityPool(pool.address, 1, 1);

      await vault.nextPhase();
      await vault.unwrapEth();
    });

    it('should reject deposits', async () => {
      await expect(pool.connect(alice).depositToken(tokenDepositAmount)).to.be.revertedWith('Invalid Phase function');
    });

    it('should reject migration from non migrator', async () => {
      poolV2 = await deployPoolV2(admin, token.address, pool.address);
      await expect(pool.connect(alice).migrateLiquidity(poolV2.address)).to.be.revertedWith('only migrator');
    });

    it('should allow migrator to migrate liquidity to v2', async () => {
      const tokenReturn = await token.balanceOf(pool.address);
      poolV2 = await deployPoolV2(admin, token.address, pool.address);

      await pool.migrateLiquidity(poolV2.address);

      expect(await token.balanceOf(pool.address)).to.eq(0);
      expect(await token.balanceOf(poolV2.address)).to.eq(tokenReturn);
    });

    it('should emit event when user migrates to v2', async () => {
      const tokenReturn = await token.balanceOf(pool.address);
      poolV2 = await deployPoolV2(admin, token.address, pool.address);
      await expect(pool.migrateLiquidity(poolV2.address))
        .to.emit(pool, 'Migration')
        .withArgs(poolV2.address, tokenReturn);
    });
  });
});
