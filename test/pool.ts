import { expect } from 'chai';
import hre, { ethers } from 'hardhat';
import { BigNumber } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import { IMasterChef, Vault, ERC20, IMasterChefV2, PoolMasterChefV2, PoolMasterChef } from '../typechain';
import { deployVault, deployPool, getERC20, getTokens, getMasterChef, getMasterChefV2, mineBlocks } from './utils';
import { getMasterChefPid, Tokens } from './constants';

describe('Rift Pool Unit tests', () => {
  const tokenName = 'Rift yearn.finance Pool';
  const tokenSymbol = 'rpYFI';
  const fixedRate = BigNumber.from('10');
  const maxEth = ethers.utils.parseEther('50');

  const ethDepositAmount = ethers.utils.parseEther('30');
  const yfiDepositAmount = ethers.utils.parseEther('100');
  const aaveDepositAmount = ethers.utils.parseEther('20');
  const alcxDepositAmount = ethers.utils.parseEther('20');
  const yfiPoolAllocation = BigNumber.from('40');
  const aavePoolAllocation = BigNumber.from('40');
  const alcxPoolAllocation = BigNumber.from('20');

  let admin: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let charlie: SignerWithAddress;

  let yfi: ERC20;
  let aave: ERC20;
  let alcx: ERC20;
  let masterChef: IMasterChef;
  let masterChefV2: IMasterChefV2;

  let vault: Vault;
  let aavePool: PoolMasterChef;
  let yfiPool: PoolMasterChef;
  let alcxPool: PoolMasterChefV2;

  before(async () => {
    // account setup
    const signers: SignerWithAddress[] = await hre.ethers.getSigners();

    [admin, alice, bob, charlie] = signers;

    // external contract setup
    yfi = await getERC20(Tokens.yfi);
    aave = await getERC20(Tokens.aave);
    alcx = await getERC20(Tokens.alcx);
    masterChef = await getMasterChef();
    masterChefV2 = await getMasterChefV2();

    // rift contract setup
    vault = await deployVault(admin, fixedRate, maxEth);
    yfiPool = (await deployPool(admin, vault, yfi)) as PoolMasterChef;
    aavePool = (await deployPool(admin, vault, aave)) as PoolMasterChef;
    alcxPool = (await deployPool(admin, vault, alcx)) as PoolMasterChefV2;
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

    it('should reject pairLiquidity calls from non-vault (master chef v1)', async () => {
      await expect(yfiPool.pairLiquidity()).to.be.revertedWith('Only Vault');
    });

    it('should reject pairLiquidity calls from non-vault (master chef v2)', async () => {
      await expect(alcxPool.pairLiquidity()).to.be.revertedWith('Only Vault');
    });

    describe('should mint pool tokens to user on deposit', async () => {
      it('YFI (Master Chef V1)', async () => {
        await getTokens(alice, yfi, yfiDepositAmount);
        await yfi.connect(alice).approve(yfiPool.address, yfiDepositAmount);
        await yfiPool.connect(alice).depositToken(yfiDepositAmount);

        expect(await yfiPool.balanceOf(alice.address)).to.eq(yfiDepositAmount);
        expect(await yfi.balanceOf(yfiPool.address)).to.eq(yfiDepositAmount);
        expect(await yfiPool.totalSupply()).to.eq(yfiDepositAmount);
      });

      it('Aave (Master Chef V1)', async () => {
        await getTokens(bob, aave, aaveDepositAmount);
        await aave.connect(bob).approve(aavePool.address, aaveDepositAmount);
        await aavePool.connect(bob).depositToken(aaveDepositAmount);

        expect(await aavePool.balanceOf(bob.address)).to.eq(aaveDepositAmount);
        expect(await aave.balanceOf(aavePool.address)).to.eq(aaveDepositAmount);
        expect(await aavePool.totalSupply()).to.eq(aaveDepositAmount);
      });

      it('ALCX (Master Chef V2)', async () => {
        await getTokens(charlie, alcx, alcxDepositAmount);
        await alcx.connect(charlie).approve(alcxPool.address, alcxDepositAmount);
        await alcxPool.connect(charlie).depositToken(alcxDepositAmount);

        expect(await alcxPool.balanceOf(charlie.address)).to.eq(alcxDepositAmount);
        expect(await alcx.balanceOf(alcxPool.address)).to.eq(alcxDepositAmount);
        expect(await alcxPool.totalSupply()).to.eq(alcxDepositAmount);
      });
    });
  });

  describe('Phase One', async () => {
    before(async () => {
      await vault.connect(alice).depositEth({ value: ethDepositAmount });
      await vault.executePhaseOne(
        [yfiPool.address, aavePool.address, alcxPool.address],
        [yfiPoolAllocation, aavePoolAllocation, alcxPoolAllocation],
      );
    });

    after(async () => {
      // fast forward blocks to receive lots of fake sushi rewards
      await mineBlocks(100);
    });

    describe('should have master chef balances', async () => {
      it('yfi-weth lp tokens', async () => {
        const lpTokensReceived = await yfiPool.lpTokenBalance();
        const yfiInfo = await masterChef.userInfo(getMasterChefPid(yfi.address), yfiPool.address);
        expect(yfiInfo.amount).to.eq(lpTokensReceived);
      });

      it('aave-weth lp tokens', async () => {
        const lpTokensReceived = await aavePool.lpTokenBalance();
        const aaveInfo = await masterChef.userInfo(getMasterChefPid(aave.address), aavePool.address);
        expect(aaveInfo.amount).to.eq(lpTokensReceived);
      });

      it('alcx-weth lp tokens', async () => {
        const lpTokensReceived = await alcxPool.lpTokenBalance();
        const alcxInfo = await masterChefV2.userInfo(getMasterChefPid(alcx.address), alcxPool.address);
        expect(alcxInfo.amount).to.eq(lpTokensReceived);
      });
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

    describe('should allow users to withdraw proportional share', async () => {
      it('YFI Withdraws', async () => {
        const poolYfiBalance = await yfi.balanceOf(yfiPool.address);
        const stakingTokenTotalSupply = await yfiPool.totalSupply();
        const aliceStakingTokenBalance = await yfiPool.balanceOf(alice.address);

        await yfiPool.connect(alice).withdrawToken(aliceStakingTokenBalance);

        const aliceYfiBalanceExpected = poolYfiBalance.mul(aliceStakingTokenBalance).div(stakingTokenTotalSupply);

        expect(await yfi.balanceOf(alice.address)).to.eq(aliceYfiBalanceExpected);
        expect(await yfiPool.balanceOf(alice.address)).to.eq(0);
        expect(await yfi.balanceOf(yfiPool.address)).to.eq(poolYfiBalance.sub(aliceYfiBalanceExpected));
      });

      it('Aave Withdraws', async () => {
        const poolAaveBalance = await aave.balanceOf(aavePool.address);
        const stakingTokenTotalSupply = await aavePool.totalSupply();
        const bobStakingTokenBalance = await aavePool.balanceOf(bob.address);

        await aavePool.connect(bob).withdrawToken(bobStakingTokenBalance);

        const bobAaveBalanceExpected = poolAaveBalance.mul(bobStakingTokenBalance).div(stakingTokenTotalSupply);

        expect(await aave.balanceOf(bob.address)).to.eq(bobAaveBalanceExpected);
        expect(await aavePool.balanceOf(bob.address)).to.eq(0);
        expect(await aave.balanceOf(aavePool.address)).to.eq(poolAaveBalance.sub(bobAaveBalanceExpected));
      });

      it('Alcx Withdraws', async () => {
        const poolAlcxBalance = await alcx.balanceOf(alcxPool.address);
        const stakingTokenTotalSupply = await alcxPool.totalSupply();
        const charlieStakingTokenBalance = await alcxPool.balanceOf(charlie.address);

        await alcxPool.connect(charlie).withdrawToken(charlieStakingTokenBalance);

        const charlieAlcxBalanceExpected = poolAlcxBalance.mul(charlieStakingTokenBalance).div(stakingTokenTotalSupply);

        expect(await alcx.balanceOf(charlie.address)).to.eq(charlieAlcxBalanceExpected);
        expect(await alcxPool.balanceOf(charlie.address)).to.eq(0);
        expect(await alcx.balanceOf(alcxPool.address)).to.eq(poolAlcxBalance.sub(charlieAlcxBalanceExpected));
      });
    });
  });
});
