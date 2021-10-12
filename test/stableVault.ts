import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ERC20, StableVault } from '../typechain';
import { deployStableVault, deployStableVaultV2, getERC20, getTokens } from './utils';
import { Addresses, Tokens } from './constants';

describe('Rift Stable Vault Unit tests', () => {
  const usdcDepositAmount = BigNumber.from(1000).mul(10e6);
  const usdtDepositAmount = BigNumber.from(500).mul(10e6);

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

    stableVault = await deployStableVault(admin);
    uniPool = await getERC20(await stableVault.pair());
  });

  describe('Deployment', async () => {
    it('should be in phase 0', async () => {
      expect(await stableVault.phase()).to.eq(0);
    });
  });

  describe('Phase 0', async () => {
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
        'Cannot execute this function during current phase',
      );
    });

    it('should not allow owner to remove liquidity', async () => {
      await expect(stableVault.removeLiquidity(0, 0)).to.be.revertedWith(
        'Cannot execute this function during current phase',
      );
    });

    it('should reject deposits of invalid tokens', async () => {
      await expect(stableVault.connect(alice).depositToken(Tokens.weth, usdcDepositAmount)).to.be.revertedWith(
        'Invalid Token',
      );
    });
  });

  describe('Phase 1', async () => {
    before(async () => {
      await stableVault.nextPhase();
    });

    it('should not allow owner to move to next phase without adding liquidity', async () => {
      await expect(stableVault.nextPhase()).to.be.revertedWith('Liquidity not added yet');
    });

    it('should reject withdraws', async () => {
      await expect(stableVault.connect(alice).withdrawToken(usdc.address, Addresses.zero)).to.be.revertedWith(
        'Cannot execute this function during current phase',
      );
    });

    it('should reject deposits', async () => {
      await expect(stableVault.connect(alice).depositToken(usdc.address, usdcDepositAmount)).to.be.revertedWith(
        'Cannot execute this function during current phase',
      );
    });

    it('should not allow owner to remove liquidity', async () => {
      await expect(stableVault.removeLiquidity(0, 0)).to.be.revertedWith(
        'Cannot execute this function during current phase',
      );
    });

    it('should allow owner to add liquidity', async () => {
      await stableVault.addLiquidity(0, 0);

      expect(await usdc.balanceOf(stableVault.address)).to.be.lt(usdcDepositAmount);
      expect(await usdt.balanceOf(stableVault.address)).to.be.lt(usdtDepositAmount);

      expect(await uniPool.balanceOf(stableVault.address)).to.be.gt(0);
    });
  });

  describe('Phase 2', async () => {
    before(async () => {
      await stableVault.nextPhase();
    });

    it('should not allow owner to move to next phase without removed liquidity', async () => {
      await expect(stableVault.nextPhase()).to.be.revertedWith('Liquidity not removed yet');
    });

    it('should reject withdraws', async () => {
      await expect(stableVault.connect(alice).withdrawToken(usdc.address, Addresses.zero)).to.be.revertedWith(
        'Cannot execute this function during current phase',
      );
    });

    it('should reject deposits', async () => {
      await expect(stableVault.connect(alice).depositToken(usdc.address, usdcDepositAmount)).to.be.revertedWith(
        'Cannot execute this function during current phase',
      );
    });

    it('should allow owner to unpair liquidity', async () => {
      const initialUsdcBalance = await usdc.balanceOf(stableVault.address);
      const initialUsdtBalance = await usdt.balanceOf(stableVault.address);

      await stableVault.removeLiquidity(0, 0);
      expect(await uniPool.balanceOf(stableVault.address)).to.eq(0);
      expect(await usdc.balanceOf(stableVault.address)).to.be.gt(initialUsdcBalance);
      expect(await usdt.balanceOf(stableVault.address)).to.be.gt(initialUsdtBalance);
    });
  });

  describe('Phase 3', async () => {
    before(async () => {
      await stableVault.nextPhase();
    });

    it('should not allow owner to move to next phase without removed liquidity', async () => {
      await expect(stableVault.nextPhase()).to.be.reverted;
    });

    it('should reject deposits', async () => {
      await expect(stableVault.connect(alice).depositToken(usdc.address, usdcDepositAmount)).to.be.revertedWith(
        'Cannot execute this function during current phase',
      );
    });

    it('should allow users to withdraw', async () => {
      const availableUsdc = await usdc.balanceOf(stableVault.address);
      const aliceUsdcBalance = await usdc.balanceOf(alice.address);

      await stableVault.connect(alice).withdrawToken(usdc.address, Addresses.zero);

      expect(await usdc.balanceOf(stableVault.address)).to.eq(0);
      expect(await usdc.balanceOf(alice.address)).to.eq(aliceUsdcBalance.add(availableUsdc));
    });

    it('should allow users to migrate liquidity', async () => {
      const stableVaultV2 = await deployStableVaultV2(admin, usdt.address);
      const availableUsdt = await usdt.balanceOf(stableVault.address);

      await stableVault.connect(bob).withdrawToken(usdt.address, stableVaultV2.address);

      expect(await usdt.balanceOf(stableVault.address)).to.eq(0);
      expect(await usdt.balanceOf(stableVaultV2.address)).to.eq(availableUsdt);
      expect(await stableVaultV2.balanceOf(bob.address)).to.eq(availableUsdt);
    });
  });
});
