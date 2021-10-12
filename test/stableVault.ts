import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ERC20, StableVault } from '../typechain';
import { deployStableVault, deployStableVaultV2, getERC20, getTokens } from './utils';
import { Addresses, Tokens } from './constants';

describe('Rift Stable Vault Unit tests', () => {
  const usdcDepositAmount = BigNumber.from(1000).mul(10e6);
  const usdcTotalDeposits = usdcDepositAmount.mul(2);
  const usdtDepositAmount = BigNumber.from(500).mul(10e6);

  let admin: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let charlie: SignerWithAddress;

  let usdc: ERC20;
  let usdt: ERC20;
  let uniPool: ERC20;

  let stableVault: StableVault;

  before(async () => {
    const signers: SignerWithAddress[] = await ethers.getSigners();

    [admin, alice, bob, charlie] = signers;

    usdc = await getERC20(Tokens.usdc);
    usdt = await getERC20(Tokens.usdt);

    stableVault = await deployStableVault(admin);
    uniPool = await getERC20(await stableVault.pair());
  });

  describe('Phase 0', async () => {
    after(async () => {
      // setup for later tests
      await getTokens(charlie, usdc, usdcDepositAmount);
      await usdc.connect(charlie).approve(stableVault.address, usdcDepositAmount);
      await stableVault.connect(charlie).depositToken(usdc.address, usdcDepositAmount);
    });

    it('should allow users to deposit usdc', async () => {
      await getTokens(alice, usdc, usdcDepositAmount);
      await usdc.connect(alice).approve(stableVault.address, usdcDepositAmount);
      await stableVault.connect(alice).depositToken(usdc.address, usdcDepositAmount);

      expect(await usdc.balanceOf(alice.address)).to.eq(0);
      expect(await usdc.balanceOf(stableVault.address)).to.eq(usdcDepositAmount);
    });

    it('should allow users to deposit usdt', async () => {
      await getTokens(bob, usdt, usdtDepositAmount);
      await usdt.connect(bob).approve(stableVault.address, usdtDepositAmount);
      await stableVault.connect(bob).depositToken(usdt.address, usdtDepositAmount);

      expect(await usdt.balanceOf(bob.address)).to.eq(0);
      expect(await usdt.balanceOf(stableVault.address)).to.eq(usdtDepositAmount);
    });

    it('should reject withdraws', async () => {
      await expect(stableVault.connect(alice).withdrawToken(usdc.address, Addresses.zero)).to.be.revertedWith(
        'Liquidity not yet removed',
      );
    });

    it('should not allow owner to remove liquidity', async () => {
      await expect(stableVault.removeLiquidity(0, 0)).to.be.revertedWith('Liquidity not yet deployed');
    });

    it('should reject deposits of invalid tokens', async () => {
      await expect(stableVault.connect(alice).depositToken(Tokens.weth, usdcDepositAmount)).to.be.revertedWith(
        'Invalid Token',
      );
    });
  });

  describe('Phase 1', async () => {
    it('should allow owner to add liquidity', async () => {
      await stableVault.addLiquidity(0, 0);

      expect(await usdc.balanceOf(stableVault.address)).to.be.lt(usdcTotalDeposits);
      expect(await usdt.balanceOf(stableVault.address)).to.be.lt(usdtDepositAmount);

      expect(await uniPool.balanceOf(stableVault.address)).to.be.gt(0);
    });

    it('should reject deposits after liquidity is deployed', async () => {
      await expect(stableVault.connect(alice).depositToken(usdc.address, usdcDepositAmount)).to.be.revertedWith(
        'Liquidity already deployed',
      );
    });

    it('should reject withdraws', async () => {
      await expect(stableVault.connect(alice).withdrawToken(usdc.address, Addresses.zero)).to.be.revertedWith(
        'Liquidity not yet removed',
      );
    });
  });

  describe('Phase 2', async () => {
    it('should allow owner to remove liquidity', async () => {
      const initialUsdcBalance = await usdc.balanceOf(stableVault.address);
      const initialUsdtBalance = await usdt.balanceOf(stableVault.address);

      await stableVault.removeLiquidity(0, 0);
      expect(await uniPool.balanceOf(stableVault.address)).to.eq(0);
      expect(await usdc.balanceOf(stableVault.address)).to.be.gt(initialUsdcBalance);
      expect(await usdt.balanceOf(stableVault.address)).to.be.gt(initialUsdtBalance);
    });

    it('should not allow owner to deploy liquidity', async () => {
      await expect(stableVault.addLiquidity(0, 0)).to.be.revertedWith('Liquidity already removed');
    });

    it('should reject deposits', async () => {
      await expect(stableVault.connect(alice).depositToken(usdc.address, usdcDepositAmount)).to.be.revertedWith(
        'Liquidity already deployed',
      );
    });

    it('should allow users to withdraw', async () => {
      const availableUsdc = await usdc.balanceOf(stableVault.address);
      const aliceUsdcBalance = await usdc.balanceOf(alice.address);
      const aliceUsdcShare = availableUsdc.mul(usdcDepositAmount).div(usdcTotalDeposits); // alice and charlie both deposited

      await stableVault.connect(alice).withdrawToken(usdc.address, Addresses.zero);

      expect(await usdc.balanceOf(stableVault.address)).to.eq(availableUsdc.sub(aliceUsdcShare));
      expect(await usdc.balanceOf(alice.address)).to.eq(aliceUsdcBalance.add(aliceUsdcShare));
    });

    it('should allow users to migrate liquidity (safeERC20)', async () => {
      const stableVaultV2 = await deployStableVaultV2(admin, usdt.address);
      const availableUsdt = await usdt.balanceOf(stableVault.address);

      await stableVault.connect(bob).withdrawToken(usdt.address, stableVaultV2.address);

      expect(await usdt.balanceOf(stableVault.address)).to.eq(0);
      expect(await usdt.balanceOf(stableVaultV2.address)).to.eq(availableUsdt);
      expect(await stableVaultV2.balanceOf(bob.address)).to.eq(availableUsdt);
    });

    it('should allow users to migrate liquidity (normal ERC20)', async () => {
      const stableVaultV2 = await deployStableVaultV2(admin, usdc.address);
      const availableUsdc = await usdc.balanceOf(stableVault.address);

      await stableVault.connect(charlie).withdrawToken(usdc.address, stableVaultV2.address);

      expect(await usdc.balanceOf(stableVault.address)).to.eq(0);
      expect(await usdc.balanceOf(stableVaultV2.address)).to.eq(availableUsdc);
      expect(await stableVaultV2.balanceOf(charlie.address)).to.eq(availableUsdc);
    });

    it('should reject withdraws when user has no balance', async () => {
      await expect(stableVault.connect(alice).withdrawToken(usdc.address, Addresses.zero)).to.be.revertedWith(
        'No balance to withdraw',
      );
    });
  });
});
