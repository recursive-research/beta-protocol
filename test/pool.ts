import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import { IMasterChef, Vault, ERC20, IMasterChefV2, Pool, PoolV2Mock } from '../typechain';
import {
  deployVault,
  deployPool,
  getERC20,
  getTokens,
  getMasterChef,
  getMasterChefV2,
  mineBlocks,
  deployPoolV2,
} from './utils';
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

  const yfiEthAllocation = ethers.utils.parseEther('15');
  const aaveEthAllocation = ethers.utils.parseEther('5');
  const alcxEthAllocation = ethDepositAmount.sub(yfiEthAllocation).sub(aaveEthAllocation);

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
  let aavePool: Pool;
  let yfiPool: Pool;
  let alcxPool: Pool;

  before(async () => {
    // account setup
    const signers: SignerWithAddress[] = await ethers.getSigners();

    [admin, alice, bob, charlie] = signers;

    // external contract setup
    yfi = await getERC20(Tokens.yfi);
    aave = await getERC20(Tokens.aave);
    alcx = await getERC20(Tokens.alcx);

    masterChef = await getMasterChef();
    masterChefV2 = await getMasterChefV2();

    // rift contract setup
    vault = await deployVault(admin, fixedRate, maxEth);
    yfiPool = await deployPool(admin, vault, yfi);
    aavePool = await deployPool(admin, vault, aave);
    alcxPool = await deployPool(admin, vault, alcx);
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

    describe('Deposits', async () => {
      it('should mint pool staking tokens on yfi deposit', async () => {
        await getTokens(alice, yfi, yfiDepositAmount);
        await yfi.connect(alice).approve(yfiPool.address, yfiDepositAmount);
        await yfiPool.connect(alice).depositToken(yfiDepositAmount);

        expect(await yfiPool.balanceOf(alice.address)).to.eq(yfiDepositAmount);
        expect(await yfi.balanceOf(yfiPool.address)).to.eq(yfiDepositAmount);
        expect(await yfiPool.totalSupply()).to.eq(yfiDepositAmount);
      });

      it('should mint pool staking tokens on aave deposit', async () => {
        await getTokens(bob, aave, aaveDepositAmount);
        await aave.connect(bob).approve(aavePool.address, aaveDepositAmount);
        await aavePool.connect(bob).depositToken(aaveDepositAmount);

        expect(await aavePool.balanceOf(bob.address)).to.eq(aaveDepositAmount);
        expect(await aave.balanceOf(aavePool.address)).to.eq(aaveDepositAmount);
        expect(await aavePool.totalSupply()).to.eq(aaveDepositAmount);
      });

      it('should mint pool staking tokens on yfi deposit', async () => {
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
      await vault.nextPhase();
      await vault.wrapEth();
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

    it('should reject pairLiquidity calls from non-vault', async () => {
      await expect(yfiPool.pairLiquidity(ethDepositAmount)).to.be.revertedWith('Only Vault');
    });

    it('should reject unpairLiquidity calls from non-vault', async () => {
      await expect(yfiPool.unpairLiquidity()).to.be.revertedWith('Only Vault');
    });

    describe('Pair Vaults liquidity', async () => {
      it('should pair and update master chef v1 balances for yfi-eth', async () => {
        await vault.pairLiquidityPool(yfiPool.address, yfiEthAllocation);

        const lpTokensReceived = await yfiPool.lpTokenBalance();
        const yfiInfo = await masterChef.userInfo(getMasterChefPid(yfi.address), yfiPool.address);

        expect(yfiInfo.amount).to.eq(lpTokensReceived);
      });

      it('should pair and update master chef v1 balances for aave-weth', async () => {
        await vault.pairLiquidityPool(aavePool.address, aaveEthAllocation);

        const lpTokensReceived = await aavePool.lpTokenBalance();
        const aaveInfo = await masterChef.userInfo(getMasterChefPid(aave.address), aavePool.address);

        expect(aaveInfo.amount).to.eq(lpTokensReceived);
      });

      it('should pair and update master chef v2 balances for alcx-weth', async () => {
        await vault.pairLiquidityPool(alcxPool.address, alcxEthAllocation);

        const lpTokensReceived = await alcxPool.lpTokenBalance();
        const alcxInfo = await masterChefV2.userInfo(getMasterChefPid(alcx.address), alcxPool.address);

        expect(alcxInfo.amount).to.eq(lpTokensReceived);
      });
    });

    describe('Unpair Vaults Liquidity', async () => {
      before(async () => {
        await mineBlocks(100);
      });

      it('should withdraw yfi-weth from master chef and return weth to vault', async () => {
        await vault.unpairLiquidityPool(yfiPool.address);

        const yfiInfo = await masterChef.userInfo(getMasterChefPid(yfi.address), yfiPool.address);
        expect(yfiInfo.amount).to.eq(0);
      });

      it('should withdraw aave-weth from master chef and return weth to vault', async () => {
        await vault.unpairLiquidityPool(aavePool.address);

        const aaveInfo = await masterChef.userInfo(getMasterChefPid(aave.address), aavePool.address);
        expect(aaveInfo.amount).to.eq(0);
      });

      it('should withdraw alcx-weth from master chef v2 and return weth to vault', async () => {
        await vault.unpairLiquidityPool(alcxPool.address);

        const alcxInfo = await masterChefV2.userInfo(getMasterChefPid(alcx.address), alcxPool.address);
        expect(alcxInfo.amount).to.eq(0);
      });
    });
  });

  describe('Phase Two', async () => {
    before(async () => {
      await vault.nextPhase();
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

    describe('Withdraw', async () => {
      it('should allow users to withdraw part of their balance', async () => {
        const poolYfiBalance = await yfi.balanceOf(yfiPool.address);
        const stakingTokenTotalSupply = await yfiPool.totalSupply();
        const aliceStakingTokenBalance = await yfiPool.balanceOf(alice.address);
        const aliceWithdrawAmount = aliceStakingTokenBalance.div(2); // withdraw half, migrate half

        await yfiPool.connect(alice).withdrawToken(aliceWithdrawAmount);

        const aliceYfiBalanceExpected = poolYfiBalance.mul(aliceWithdrawAmount).div(stakingTokenTotalSupply);

        expect(await yfi.balanceOf(alice.address)).to.eq(aliceYfiBalanceExpected);
        expect(await yfiPool.balanceOf(alice.address)).to.eq(aliceStakingTokenBalance.sub(aliceWithdrawAmount));
        expect(await yfi.balanceOf(yfiPool.address)).to.eq(poolYfiBalance.sub(aliceYfiBalanceExpected));
      });

      it('should allow users to withdraw their full balance', async () => {
        const poolAaveBalance = await aave.balanceOf(aavePool.address);
        const stakingTokenTotalSupply = await aavePool.totalSupply();
        const bobStakingTokenBalance = await aavePool.balanceOf(bob.address);

        await aavePool.connect(bob).withdrawToken(bobStakingTokenBalance);

        const bobAaveBalanceExpected = poolAaveBalance.mul(bobStakingTokenBalance).div(stakingTokenTotalSupply);

        expect(await aave.balanceOf(bob.address)).to.eq(bobAaveBalanceExpected);
        expect(await aavePool.balanceOf(bob.address)).to.eq(0);
        expect(await aave.balanceOf(aavePool.address)).to.eq(poolAaveBalance.sub(bobAaveBalanceExpected));
      });

      it('should allow users to withdraw their full balance', async () => {
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

    describe('Migrate to V2', async () => {
      it('should reject migrations when amount is greater than their balance', async () => {
        const yfiPoolV2: PoolV2Mock = await deployPoolV2(admin, yfi.address);
        const aliceStakingTokenBalance = await yfiPool.balanceOf(alice.address);
        await expect(
          yfiPool.connect(alice).withdrawAndMigrate(yfiPoolV2.address, aliceStakingTokenBalance.add(1)),
        ).to.be.revertedWith('Withdraw amount exceeds balance');
      });

      it('should allow users to migrate their liquidity to v2', async () => {
        const yfiPoolV2: PoolV2Mock = await deployPoolV2(admin, yfi.address);

        const poolYfiBalance = await yfi.balanceOf(yfiPool.address);
        const aliceStakingTokenBalance = await yfiPool.balanceOf(alice.address);
        const aliceYfiShare = await yfiPool.tokenShare(alice.address);

        await yfiPool.connect(alice).withdrawAndMigrate(yfiPoolV2.address, aliceStakingTokenBalance);

        expect(await yfiPool.balanceOf(alice.address)).to.eq(0);
        expect(await yfi.balanceOf(yfiPool.address)).to.eq(poolYfiBalance.sub(aliceYfiShare));
        expect(await yfi.balanceOf(yfiPoolV2.address)).to.eq(aliceYfiShare);
        expect(await yfiPoolV2.balanceOf(alice.address)).to.eq(aliceYfiShare);
      });
    });
  });
});
