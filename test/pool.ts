import { expect } from 'chai';
import hre, { ethers } from 'hardhat';
import { BigNumber } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import { Vault, Pool, ERC20 } from '../typechain';
import { deployVault, deployPool, getERC20, getTokens } from './utils';
import { Tokens } from './constants';

describe('Rift Pool Unit tests', () => {
  const tokenName = 'Rift yearn.finance Pool';
  const tokenSymbol = 'rpYFI';
  const fixedRate = BigNumber.from('10');
  const maxEth = ethers.utils.parseEther('10');
  const ethDepositAmount = ethers.utils.parseEther('8');
  const yfiDepositAmount = ethers.utils.parseEther('100');
  const aaveDepositAmount = ethers.utils.parseEther('20');
  const yfiPoolAllocation = BigNumber.from('50');
  const aavePoolAllocation = BigNumber.from('50');

  let admin: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  let yfi: ERC20;
  let aave: ERC20;

  let vault: Vault;
  let aavePool: Pool;
  let yfiPool: Pool;

  before(async () => {
    // account setup
    const signers: SignerWithAddress[] = await hre.ethers.getSigners();

    [admin, alice, bob] = signers;

    // external contract setup
    yfi = await getERC20(Tokens.yfi);
    aave = await getERC20(Tokens.aave);

    // rift contract setup
    vault = await deployVault(admin, fixedRate, maxEth);
    yfiPool = await deployPool(admin, vault, yfi);
    aavePool = await deployPool(admin, vault, aave);
  });

  describe('Deployment', async () => {
    it('should correctly assign token metadata', async () => {
      expect(await yfiPool.name()).to.eq(tokenName);
      expect(await yfiPool.symbol()).to.eq(tokenSymbol);
    });

    it('should mint no tokens on deployment', async () => {
      expect(await vault.totalSupply()).to.eq(0);
    });

    it('should store vault and token address on deployment', async () => {
      expect(await yfiPool.vault()).to.eq(vault.address);
      expect(await yfiPool.token()).to.eq(yfi.address);
    });
  });

  describe('Phase Zero', async () => {
    it('should reject deposits when amount exceeds balance', async () => {
      await expect(yfiPool.connect(alice).depositToken(yfiDepositAmount)).to.be.revertedWith(
        'ERC20: transfer amount exceeds balance',
      );
    });

    it('should reject withdraws', async () => {
      await expect(yfiPool.connect(alice).withdrawToken(yfiDepositAmount)).to.be.revertedWith(
        'Cannot execute this function during current phase',
      );
    });

    it('should reject pairLiquidity calls from non-vault', async () => {
      await expect(yfiPool.pairLiquidity()).to.be.revertedWith('Only Vault');
    });

    it('should mint pool tokens to user on deposit', async () => {
      await getTokens(alice, yfi, yfiDepositAmount);
      await yfi.connect(alice).approve(yfiPool.address, yfiDepositAmount);
      await yfiPool.connect(alice).depositToken(yfiDepositAmount);

      expect(await yfiPool.balanceOf(alice.address)).to.eq(yfiDepositAmount);
      expect(await yfi.balanceOf(yfiPool.address)).to.eq(yfiDepositAmount);
      expect(await yfiPool.totalSupply()).to.eq(yfiDepositAmount);
    });

    it('should mint pool tokens to user on deposit', async () => {
      await getTokens(bob, aave, aaveDepositAmount);
      await aave.connect(bob).approve(aavePool.address, aaveDepositAmount);
      await aavePool.connect(bob).depositToken(aaveDepositAmount);

      expect(await aavePool.balanceOf(bob.address)).to.eq(aaveDepositAmount);
      expect(await aave.balanceOf(aavePool.address)).to.eq(aaveDepositAmount);
      expect(await aavePool.totalSupply()).to.eq(aaveDepositAmount);
    });
  });

  describe('Phase One', async () => {
    before(async () => {
      await vault.connect(alice).depositEth({ value: ethDepositAmount });
      await vault.executePhaseOne([yfiPool.address, aavePool.address], [yfiPoolAllocation, aavePoolAllocation]);
    });

    it('should reject deposits', async () => {
      await expect(yfiPool.connect(alice).depositToken(yfiDepositAmount)).to.be.revertedWith(
        'Cannot execute this function during current phase',
      );
    });

    it('should reject withdraws', async () => {
      await expect(yfiPool.connect(alice).withdrawToken(yfiDepositAmount)).to.be.revertedWith(
        'Cannot execute this function during current phase',
      );
    });
  });

  describe('Phase Two', async () => {
    before(async () => {
      await vault.executePhaseTwo();
    });

    it('should reject deposits', async () => {
      await expect(yfiPool.connect(alice).depositToken(yfiDepositAmount)).to.be.revertedWith(
        'Cannot execute this function during current phase',
      );
    });

    it('should reject withdraw when withdraw amount exceeds balance', async () => {
      await expect(yfiPool.connect(alice).withdrawToken(yfiDepositAmount.add(1))).to.be.revertedWith(
        'Withdraw amount exceeds balance',
      );
    });

    it('should allow users to withdraw proportional share', async () => {
      const poolYfiBalance = await yfi.balanceOf(yfiPool.address);
      const stakingTokenTotalSupply = await yfiPool.totalSupply();
      const aliceStakingTokenBalance = await yfiPool.balanceOf(alice.address);

      await yfiPool.connect(alice).withdrawToken(aliceStakingTokenBalance);

      const aliceYfiBalanceExpected = poolYfiBalance.mul(aliceStakingTokenBalance).div(stakingTokenTotalSupply);

      expect(await yfi.balanceOf(alice.address)).to.eq(aliceYfiBalanceExpected);
      expect(await yfiPool.balanceOf(alice.address)).to.eq(0);
      expect(await yfi.balanceOf(yfiPool.address)).to.eq(poolYfiBalance.sub(aliceYfiBalanceExpected));
    });
  });
});
