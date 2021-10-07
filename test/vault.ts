import { expect } from 'chai';
import { BigNumber } from 'ethers';
import hre, { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import { deployVault } from './utils';
import { Vault } from '../typechain';

describe('Rift Vault Unit tests', () => {
  const tokenName = 'RIFT - Fixed Rate ETH';
  const tokenSymbol = 'frETH';
  const fixedRate = BigNumber.from('10');
  const ethDeposit = ethers.utils.parseEther('10');

  let admin: SignerWithAddress;
  let alice: SignerWithAddress;

  let vault: Vault;

  before(async () => {
    // account setup
    const signers: SignerWithAddress[] = await hre.ethers.getSigners();

    admin = signers[0];
    alice = signers[1];

    // contract setup
    vault = await deployVault(admin, fixedRate);
  });

  describe('Deployment', async () => {
    it('should correctly assign erc20 metadata', async () => {
      expect(await vault.name()).to.eq(tokenName);
      expect(await vault.symbol()).to.eq(tokenSymbol);
    });

    it('should mint no tokens on deployment', async () => {
      expect(await vault.totalSupply()).to.eq(0);
    });
  });

  describe('Phase Zero', async () => {
    it('should be in phase zero on initialization', async () => {
      expect(await vault.phase()).to.eq(0);
    });

    it('should reject phase update from non owner', async () => {
      await expect(vault.connect(alice).executePhaseOne()).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('should reject moving to phase 2', async () => {
      await expect(vault.executePhaseTwo()).to.be.revertedWith('Cannot execute this function during current phase');
    });

    it('should mint user tokens on ETH deposit', async () => {
      await vault.connect(alice).depositEth({ value: ethDeposit });

      expect(await vault.balanceOf(alice.address)).to.eq(ethDeposit);
    });

    it('should allow owner to move to phase 1', async () => {
      await vault.executePhaseOne();
      expect(await vault.phase()).to.eq(1);
    });
  });

  describe('Phase One', async () => {
    it('should be in phase one', async () => {
      expect(await vault.phase()).to.eq(1);
    });

    it('should reject phase update from non owner', async () => {
      await expect(vault.connect(alice).executePhaseTwo()).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('should reject calling executePhaseOne again', async () => {
      await expect(vault.executePhaseOne()).to.be.revertedWith('Cannot execute this function during current phase');
    });

    it('should reject users depositing ETH', async () => {
      await expect(vault.connect(alice).depositEth({ value: ethDeposit })).to.be.revertedWith(
        'Cannot execute this function during current phase',
      );
    });

    it('should allow owner to move to phase 2', async () => {
      await vault.executePhaseTwo();
      expect(await vault.phase()).to.eq(2);
    });
  });

  describe('Phase Two', async () => {
    it('should reject changing the phase', async () => {
      await expect(vault.executePhaseOne()).to.be.revertedWith('Cannot execute this function during current phase');
      await expect(vault.executePhaseTwo()).to.be.revertedWith('Cannot execute this function during current phase');
    });

    it('should reject users depositing ETH', async () => {
      await expect(vault.connect(alice).depositEth({ value: ethDeposit })).to.be.revertedWith(
        'Cannot execute this function during current phase',
      );
    });
  });
});
