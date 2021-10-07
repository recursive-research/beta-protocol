import { expect } from 'chai';
import { BigNumber } from 'ethers';
import hre, { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import { deployPool, deployVault, getERC20, getTokens } from './utils';
import { Vault, ERC20, PoolMasterChef } from '../typechain';
import { Tokens } from './constants';

describe('Rift Vault Unit tests', () => {
  const tokenName = 'RIFT - Fixed Rate ETH';
  const tokenSymbol = 'frETH';
  const fixedRate = BigNumber.from('10');
  const ethDepositAmount = ethers.utils.parseEther('8');
  const yfiDepositAmount = ethers.utils.parseEther('100');
  const yfiPoolAllocation = BigNumber.from('50');
  const maxEth = ethers.utils.parseEther('10');
  const newMaxEth = ethers.utils.parseEther('20');

  let admin: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  let yfi: ERC20;
  let weth: ERC20;

  let vault: Vault;
  let pool: PoolMasterChef;

  before(async () => {
    // account setup
    const signers: SignerWithAddress[] = await hre.ethers.getSigners();
    [admin, alice, bob] = signers;

    // external contract setup
    yfi = await getERC20(Tokens.yfi);
    weth = await getERC20(Tokens.weth);

    // contract setup
    vault = await deployVault(admin, fixedRate, maxEth);
    pool = (await deployPool(admin, vault, yfi)) as PoolMasterChef;
  });

  describe('Deployment', async () => {
    it('should correctly assign erc20 metadata', async () => {
      expect(await vault.name()).to.eq(tokenName);
      expect(await vault.symbol()).to.eq(tokenSymbol);
    });

    it('should mint no tokens on deployment', async () => {
      expect(await vault.totalSupply()).to.eq(0);
    });

    it('should correctly assign initial state variables', async () => {
      expect(await vault.fixedRate()).to.eq(fixedRate);
      expect(await vault.maxEth()).to.eq(maxEth);
    });
  });

  describe('Phase Zero', async () => {
    it('should be in phase zero on initialization', async () => {
      expect(await vault.phase()).to.eq(0);
    });

    it('should reject phase update from non owner', async () => {
      await expect(vault.connect(alice).executePhaseOne([], [])).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('should reject moving to phase 2', async () => {
      await expect(vault.executePhaseTwo()).to.be.revertedWith('Cannot execute this function during current phase');
    });

    it('should mint user tokens on ETH deposit', async () => {
      await vault.connect(alice).depositEth({ value: ethDepositAmount });

      expect(await vault.balanceOf(alice.address)).to.eq(ethDepositAmount);
      expect(await ethers.provider.getBalance(vault.address)).to.eq(ethDepositAmount);
      expect(await vault.totalSupply()).to.eq(ethDepositAmount);
    });

    it('should reject withdraw', async () => {
      await expect(vault.connect(alice).withdrawEth(ethDepositAmount)).to.be.revertedWith(
        'Cannot execute this function during current phase',
      );
    });

    it('should reject deposits that overflow maxEth', async () => {
      await expect(vault.connect(bob).depositEth({ value: ethDepositAmount })).to.be.revertedWith(
        'Max eth cap has been hit',
      );
    });

    it('should allow owner to update maxEth', async () => {
      await vault.updateMaxEth(newMaxEth);
      expect(await vault.maxEth()).to.eq(newMaxEth);
    });

    it('should allow a user to deposit after cap has been raised', async () => {
      await vault.connect(bob).depositEth({ value: ethDepositAmount });

      expect(await vault.balanceOf(bob.address)).to.eq(ethDepositAmount);
      expect(await ethers.provider.getBalance(vault.address)).to.eq(ethDepositAmount.mul(2));
      expect(await vault.totalSupply()).to.eq(ethDepositAmount.mul(2));
    });

    it('should allow owner to move to phase 1', async () => {
      await getTokens(alice, yfi, yfiDepositAmount);
      await yfi.connect(alice).approve(pool.address, yfiDepositAmount);
      await pool.connect(alice).depositToken(yfiDepositAmount);

      const vaultEthBalanceInitial = await ethers.provider.getBalance(vault.address);
      await vault.executePhaseOne([pool.address], [yfiPoolAllocation]);
      const vaultEthBalanceFinal = await weth.balanceOf(vault.address);

      expect(vaultEthBalanceInitial.sub(vaultEthBalanceFinal)).to.eq(
        vaultEthBalanceInitial.mul(yfiPoolAllocation).div(100),
      );
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
      await expect(vault.executePhaseOne([], [])).to.be.revertedWith(
        'Cannot execute this function during current phase',
      );
    });

    it('should reject users depositing ETH', async () => {
      await expect(vault.connect(alice).depositEth({ value: ethDepositAmount })).to.be.revertedWith(
        'Cannot execute this function during current phase',
      );
    });

    it('should reject withdraw', async () => {
      await expect(vault.connect(alice).withdrawEth(ethDepositAmount)).to.be.revertedWith(
        'Cannot execute this function during current phase',
      );
    });

    it('should reject owner updating maxEth', async () => {
      await expect(vault.updateMaxEth(newMaxEth.mul(2))).to.be.revertedWith(
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
      await expect(vault.executePhaseOne([], [])).to.be.revertedWith(
        'Cannot execute this function during current phase',
      );
      await expect(vault.executePhaseTwo()).to.be.revertedWith('Cannot execute this function during current phase');
    });

    it('should reject users depositing ETH', async () => {
      await expect(vault.connect(alice).depositEth({ value: ethDepositAmount })).to.be.revertedWith(
        'Cannot execute this function during current phase',
      );
    });

    it('should reject owner updating maxEth', async () => {
      await expect(vault.updateMaxEth(newMaxEth.mul(2))).to.be.revertedWith(
        'Cannot execute this function during current phase',
      );
    });

    it('should reject withdraw when withdraw amount exceeds balance', async () => {
      const aliceStakingTokenBalance = await vault.balanceOf(alice.address);
      await expect(vault.connect(alice).withdrawEth(aliceStakingTokenBalance.add(1))).to.be.revertedWith(
        'Withdraw amount exceeds balance',
      );
    });

    it('should allow users to withdraw proportional share', async () => {
      const vaultEthBalance = await ethers.provider.getBalance(vault.address);
      const stakingTokenTotalSupply = await vault.totalSupply();
      const aliceStakingTokenBalance = await vault.balanceOf(alice.address);
      const aliceEthBalanceInitial = await ethers.provider.getBalance(alice.address);

      await vault.connect(alice).withdrawEth(aliceStakingTokenBalance);

      const aliceEthBalanceFinal = await ethers.provider.getBalance(alice.address);
      const aliceEthBalanceIncrease = aliceEthBalanceFinal.sub(aliceEthBalanceInitial);
      const aliceEthShare = vaultEthBalance.mul(aliceStakingTokenBalance).div(stakingTokenTotalSupply);

      expect(aliceEthBalanceIncrease).to.be.gt(aliceEthShare.mul(99).div(100));
      expect(await vault.balanceOf(alice.address)).to.eq(0);
      expect(await ethers.provider.getBalance(vault.address)).to.eq(vaultEthBalance.sub(aliceEthShare));
    });
  });
});
