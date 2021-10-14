import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ERC20, StableVault } from '../typechain';
import { deployStableVault, deployStableVaultV2, getERC20, getTokens } from './utils';
import { Addresses, Tokens } from './constants';

describe('Rift Stable Vault Unit tests', () => {
  const usdcDepositAmount = BigNumber.from(1000).mul(1e6);
  const usdtDepositAmount = BigNumber.from(500).mul(1e6);

  const swapInUsdcAmount = BigNumber.from(250).mul(1e6);
  const swapOutUsdtAmount = BigNumber.from(245).mul(1e6);

  const swapInUsdtAmount = BigNumber.from(245).mul(1e6);
  const swapOutUsdcAmount = BigNumber.from(240).mul(1e6);

  let admin: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  let usdc: ERC20;
  let usdt: ERC20;
  let uniPool: ERC20;

  let stableVault: StableVault;

  before(async () => {
    const signers: SignerWithAddress[] = await ethers.getSigners();

    [admin, alice, bob] = signers;

    usdc = await getERC20(Tokens.usdc);
    usdt = await getERC20(Tokens.usdt);
  });

  describe('Deposits', async () => {
    beforeEach(async () => {
      stableVault = await deployStableVault(admin);
      uniPool = await getERC20(await stableVault.pair());
    });

    it('should allow users to deposit usdc', async () => {
      await getTokens(alice, usdc, usdcDepositAmount);
      await usdc.connect(alice).approve(stableVault.address, usdcDepositAmount);

      await stableVault.connect(alice).depositToken(usdc.address, usdcDepositAmount);

      expect(await usdc.balanceOf(alice.address)).to.eq(0);
      expect(await usdc.balanceOf(stableVault.address)).to.eq(usdcDepositAmount);
    });

    it('should emit event on usdc deposit', async () => {
      await getTokens(alice, usdc, usdcDepositAmount);
      await usdc.connect(alice).approve(stableVault.address, usdcDepositAmount);

      await expect(stableVault.connect(alice).depositToken(usdc.address, usdcDepositAmount))
        .to.emit(stableVault, 'Deposit')
        .withArgs(usdc.address, alice.address, usdcDepositAmount);
    });

    it('should allow users to deposit usdt', async () => {
      await getTokens(alice, usdt, usdtDepositAmount);
      await usdt.connect(alice).approve(stableVault.address, usdtDepositAmount);
      await stableVault.connect(alice).depositToken(usdt.address, usdtDepositAmount);

      expect(await usdt.balanceOf(alice.address)).to.eq(0);
      expect(await usdt.balanceOf(stableVault.address)).to.eq(usdtDepositAmount);
    });

    it('should reject withdraws', async () => {
      await expect(stableVault.connect(alice).withdrawToken(usdc.address, Addresses.zero)).to.be.revertedWith(
        'Liquidity not yet removed',
      );
    });

    it('should not allow owner to remove liquidity', async () => {
      await expect(stableVault.removeLiquidity(0, 0, 0, 0, true)).to.be.revertedWith('Liquidity not yet deployed');
    });

    it('should reject deposits of invalid tokens', async () => {
      await expect(stableVault.connect(alice).depositToken(Tokens.weth, usdcDepositAmount)).to.be.revertedWith(
        'Invalid Token',
      );
    });
  });

  describe('Adding Liquidity', async () => {
    beforeEach(async () => {
      stableVault = await deployStableVault(admin);
      uniPool = await getERC20(await stableVault.pair());

      await getTokens(alice, usdc, usdcDepositAmount);
      await usdc.connect(alice).approve(stableVault.address, usdcDepositAmount);
      await stableVault.connect(alice).depositToken(usdc.address, usdcDepositAmount);

      await getTokens(bob, usdt, usdtDepositAmount);
      await usdt.connect(bob).approve(stableVault.address, usdtDepositAmount);
      await stableVault.connect(bob).depositToken(usdt.address, usdtDepositAmount);
    });

    it('should allow owner to pair liquidity', async () => {
      const usdcExcessExpected = 501005962;
      await stableVault.addLiquidity(0, 0, 0, 0, true);

      expect(await usdc.balanceOf(stableVault.address)).to.eq(usdcExcessExpected);
      expect(await usdt.balanceOf(stableVault.address)).to.eq(0);

      expect(await uniPool.balanceOf(stableVault.address)).to.be.gt(0);
    });

    it('should allow owner to pair liquidity and swap usdc for usdt', async () => {
      const usdcExcessExpected = 1719409;
      await stableVault.addLiquidity(0, 0, swapInUsdcAmount, swapOutUsdtAmount, true);

      expect(await usdc.balanceOf(stableVault.address)).to.eq(usdcExcessExpected);
      expect(await usdt.balanceOf(stableVault.address)).to.eq(0);

      expect(await uniPool.balanceOf(stableVault.address)).to.be.gt(0);
    });

    it('should reject deposits after liquidity is deployed', async () => {
      await stableVault.addLiquidity(0, 0, 0, 0, true);
      await expect(stableVault.connect(alice).depositToken(usdc.address, usdcDepositAmount)).to.be.revertedWith(
        'Liquidity already deployed',
      );
    });

    it('should reject withdraws', async () => {
      await stableVault.addLiquidity(0, 0, 0, 0, true);
      await expect(stableVault.connect(alice).withdrawToken(usdc.address, Addresses.zero)).to.be.revertedWith(
        'Liquidity not yet removed',
      );
    });
  });

  describe('Unpairing Liquidity', async () => {
    beforeEach(async () => {
      stableVault = await deployStableVault(admin);
      uniPool = await getERC20(await stableVault.pair());

      await getTokens(alice, usdc, usdcDepositAmount);
      await usdc.connect(alice).approve(stableVault.address, usdcDepositAmount);
      await stableVault.connect(alice).depositToken(usdc.address, usdcDepositAmount);

      await getTokens(bob, usdt, usdtDepositAmount);
      await usdt.connect(bob).approve(stableVault.address, usdtDepositAmount);
      await stableVault.connect(bob).depositToken(usdt.address, usdtDepositAmount);

      await stableVault.addLiquidity(0, 0, swapInUsdcAmount, swapOutUsdtAmount, true);
    });

    it('should reject deposits', async () => {
      await expect(stableVault.connect(alice).depositToken(usdc.address, usdcDepositAmount)).to.be.revertedWith(
        'Liquidity already deployed',
      );
    });

    it('should allow owner to unpair liquidity and return tokens to users', async () => {
      const initialUsdcBalance = await usdc.balanceOf(stableVault.address);
      const initialUsdtBalance = await usdt.balanceOf(stableVault.address);

      await stableVault.removeLiquidity(0, 0, 0, 0, true);

      expect(await uniPool.balanceOf(stableVault.address)).to.eq(0);
      expect(await usdc.balanceOf(stableVault.address)).to.be.gt(initialUsdcBalance);
      expect(await usdt.balanceOf(stableVault.address)).to.be.gt(initialUsdtBalance);
    });

    it('should allow owner to unpair liquidity with swap and return tokens to users', async () => {
      const initialUsdcBalance = await usdc.balanceOf(stableVault.address);
      const initialUsdtBalance = await usdt.balanceOf(stableVault.address);

      await stableVault.removeLiquidity(0, 0, swapInUsdtAmount, swapOutUsdcAmount, true);

      expect(await uniPool.balanceOf(stableVault.address)).to.eq(0);
      expect(await usdc.balanceOf(stableVault.address)).to.be.gt(initialUsdcBalance);
      expect(await usdt.balanceOf(stableVault.address)).to.be.gt(initialUsdtBalance);
    });
  });

  describe('Withdraws', async () => {
    beforeEach(async () => {
      stableVault = await deployStableVault(admin);
      uniPool = await getERC20(await stableVault.pair());

      await getTokens(alice, usdc, usdcDepositAmount);
      await usdc.connect(alice).approve(stableVault.address, usdcDepositAmount);
      await stableVault.connect(alice).depositToken(usdc.address, usdcDepositAmount);

      await getTokens(bob, usdt, usdtDepositAmount);
      await usdt.connect(bob).approve(stableVault.address, usdtDepositAmount);
      await stableVault.connect(bob).depositToken(usdt.address, usdtDepositAmount);

      await stableVault.addLiquidity(0, 0, swapInUsdcAmount, swapOutUsdtAmount, true);
      await stableVault.removeLiquidity(0, 0, swapInUsdtAmount, swapOutUsdcAmount, false);
    });

    it('should not allow owner to deploy liquidity', async () => {
      await expect(stableVault.addLiquidity(0, 0, 0, 0, false)).to.be.revertedWith('Liquidity already removed');
    });

    it('should reject withdraws when user has no balance', async () => {
      await expect(stableVault.connect(alice).withdrawToken(usdt.address, Addresses.zero)).to.be.revertedWith(
        'No balance to withdraw',
      );
    });

    it('should allow users to withdraw', async () => {
      const availableUsdc = await usdc.balanceOf(stableVault.address);

      await stableVault.connect(alice).withdrawToken(usdc.address, Addresses.zero);

      expect(await usdc.balanceOf(stableVault.address)).to.eq(0);
      expect(await usdc.balanceOf(alice.address)).to.eq(availableUsdc);
    });

    it('should emit event on user withdraw', async () => {
      const availableUsdc = await usdc.balanceOf(stableVault.address);
      await expect(stableVault.connect(alice).withdrawToken(usdc.address, Addresses.zero))
        .to.emit(stableVault, 'Withdraw')
        .withArgs(usdc.address, alice.address, availableUsdc);
    });

    it('should allow users to migrate liquidity', async () => {
      const stableVaultV2 = await deployStableVaultV2(admin, usdc.address);
      const availableUsdc = await usdc.balanceOf(stableVault.address);

      await stableVault.connect(alice).withdrawToken(usdc.address, stableVaultV2.address);

      expect(await usdc.balanceOf(stableVault.address)).to.eq(0);
      expect(await usdc.balanceOf(stableVaultV2.address)).to.eq(availableUsdc);
      expect(await stableVaultV2.balanceOf(alice.address)).to.eq(availableUsdc);
    });

    it('should emit event on user migration', async () => {
      const stableVaultV2 = await deployStableVaultV2(admin, usdc.address);
      const availableUsdc = await usdc.balanceOf(stableVault.address);

      await expect(stableVault.connect(alice).withdrawToken(usdc.address, stableVaultV2.address))
        .to.emit(stableVault, 'Migration')
        .withArgs(usdc.address, alice.address, availableUsdc);
    });
  });
});
