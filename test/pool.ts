import { expect } from 'chai';
import hre, { ethers } from 'hardhat';
import { BigNumber } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import { Vault, Pool, ERC20 } from '../typechain';
import { deployVault, deployPool, getERC20, getTokens } from './utils';
import { Tokens } from './constants';

describe('Rift Pool Unit tests', () => {
  const tokenName = 'Rift SushiToken Pool';
  const tokenSymbol = 'rpSUSHI';
  const fixedRate = BigNumber.from('10');
  const maxEth = ethers.utils.parseEther('10');
  const sushiDepositAmount = ethers.utils.parseEther('100');

  let admin: SignerWithAddress;
  let alice: SignerWithAddress;

  let sushi: ERC20;

  let vault: Vault;
  let pool: Pool;

  before(async () => {
    // account setup
    const signers: SignerWithAddress[] = await hre.ethers.getSigners();

    [admin, alice] = signers;

    // external contract setup
    sushi = await getERC20(Tokens.sushi);

    // rift contract setup
    vault = await deployVault(admin, fixedRate, maxEth);
    pool = await deployPool(admin, vault, sushi);
  });

  describe('Deployment', async () => {
    it('should correctly assign token metadata', async () => {
      expect(await pool.name()).to.eq(tokenName);
      expect(await pool.symbol()).to.eq(tokenSymbol);
    });

    it('should mint no tokens on deployment', async () => {
      expect(await vault.totalSupply()).to.eq(0);
    });

    it('should store vault and token address on deployment', async () => {
      expect(await pool.vault()).to.eq(vault.address);
      expect(await pool.token()).to.eq(sushi.address);
    });
  });

  describe('Phase Zero', async () => {
    it('should reject deposits when amount exceeds balance', async () => {
      await expect(pool.connect(alice).depositToken(sushiDepositAmount)).to.be.revertedWith(
        'ERC20: transfer amount exceeds balance',
      );
    });

    it('should reject withdraws', async () => {
      await expect(pool.connect(alice).withdrawToken(sushiDepositAmount)).to.be.revertedWith(
        'Cannot execute this function during current phase',
      );
    });

    it('should mint pool tokens to user on deposit', async () => {
      await getTokens(alice, sushi, sushiDepositAmount);
      await sushi.connect(alice).approve(pool.address, sushiDepositAmount);
      await pool.connect(alice).depositToken(sushiDepositAmount);

      expect(await pool.balanceOf(alice.address)).to.eq(sushiDepositAmount);
      expect(await sushi.balanceOf(pool.address)).to.eq(sushiDepositAmount);
      expect(await pool.totalSupply()).to.eq(sushiDepositAmount);
    });
  });

  describe('Phase One', async () => {
    before(async () => {
      await vault.executePhaseOne();
    });

    it('should reject deposits', async () => {
      await expect(pool.connect(alice).depositToken(sushiDepositAmount)).to.be.revertedWith(
        'Cannot execute this function during current phase',
      );
    });

    it('should reject withdraws', async () => {
      await expect(pool.connect(alice).withdrawToken(sushiDepositAmount)).to.be.revertedWith(
        'Cannot execute this function during current phase',
      );
    });
  });

  describe('Phase Two', async () => {
    before(async () => {
      await vault.executePhaseTwo();
    });

    it('should reject deposits', async () => {
      await expect(pool.connect(alice).depositToken(sushiDepositAmount)).to.be.revertedWith(
        'Cannot execute this function during current phase',
      );
    });

    it('should reject withdraw when withdraw amount exceeds balance', async () => {
      await expect(pool.connect(alice).withdrawToken(sushiDepositAmount.mul(2))).to.be.revertedWith(
        'Withdraw amount exceeds balance',
      );
    });

    it('should allow users to withdraw proportional share', async () => {
      await pool.connect(alice).withdrawToken(sushiDepositAmount);

      expect(await sushi.balanceOf(alice.address)).to.eq(sushiDepositAmount);
      expect(await pool.balanceOf(alice.address)).to.eq(0);
      expect(await sushi.balanceOf(pool.address)).to.eq(0);
    });
  });
});
