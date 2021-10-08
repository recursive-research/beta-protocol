import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import { IMasterChef, Vault, ERC20, IMasterChefV2, Pool, PoolV2Mock, IWETH } from '../typechain';
import {
  deployVault,
  deployPool,
  getERC20,
  getTokens,
  getMasterChef,
  getMasterChefV2,
  mineBlocks,
  deployPoolV2,
  getWETH,
} from './utils';
import { Addresses, getMasterChefPid, Tokens } from './constants';

describe('Rift Pool Unit tests', () => {
  const tokenName = 'Rift yearn.finance Pool';
  const tokenSymbol = 'rpYFI';
  const fixedRate = BigNumber.from('10');
  const maxEth = ethers.utils.parseEther('50');

  const ethDepositAmount = ethers.utils.parseEther('30');
  const tokenMCDepositAmount = ethers.utils.parseEther('100');
  const tokenMC2DepositAmount = ethers.utils.parseEther('20');
  const tokenBasicDepositAmount = ethers.utils.parseEther('20');

  const tokenMCEthAllocation = ethers.utils.parseEther('15');
  const tokenMC2EthAllocation = ethers.utils.parseEther('5');
  const tokenBasicEthAllocation = ethDepositAmount.sub(tokenMCEthAllocation).sub(tokenMC2EthAllocation);

  let admin: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let charlie: SignerWithAddress;

  let weth: IWETH;
  let tokenMC: ERC20;
  let tokenMC2: ERC20;
  let tokenBasic: ERC20;
  let masterChef: IMasterChef;
  let masterChefV2: IMasterChefV2;

  let vault: Vault;
  let tokenMC2Pool: Pool;
  let tokenMCPool: Pool;
  let tokenBasicPool: Pool;

  before(async () => {
    // account setup
    const signers: SignerWithAddress[] = await ethers.getSigners();

    [admin, alice, bob, charlie] = signers;

    // external contract setup
    weth = await getWETH();
    // -- token whose SLP tokens are rewarded by MasterChef
    tokenMC = await getERC20(Tokens.yfi);
    // -- token whose SLP tokens are rewarded by MasterChefV2
    tokenMC2 = await getERC20(Tokens.alcx);
    // -- token whose SLP tokens don't receive sushi. Not actually true for Aave but we can test our functionality
    tokenBasic = await getERC20(Tokens.aave);

    masterChef = await getMasterChef();
    masterChefV2 = await getMasterChefV2();

    // rift contract setup
    vault = await deployVault(admin, fixedRate, maxEth);
    tokenMCPool = await deployPool(admin, vault, tokenMC);
    tokenMC2Pool = await deployPool(admin, vault, tokenMC2);
    tokenBasicPool = await deployPool(admin, vault, tokenBasic);
  });

  describe('Deployment', async () => {
    it('should correctly assign token metadata', async () => {
      expect(await tokenMCPool.name()).to.eq(tokenName);
      expect(await tokenMCPool.symbol()).to.eq(tokenSymbol);
    });

    it('should mint no tokens on deployment', async () => {
      expect(await vault.totalSupply()).to.eq(0);
    });

    it('should store vault and token address on deployment', async () => {
      expect(await tokenMCPool.vault()).to.eq(vault.address);
      expect(await tokenMCPool.token()).to.eq(tokenMC.address);
    });
  });

  describe('Phase Zero', async () => {
    it('should reject deposits when amount exceeds balance', async () => {
      await expect(tokenMCPool.connect(alice).depositToken(tokenMCDepositAmount)).to.be.revertedWith(
        'ERC20: transfer amount exceeds balance',
      );
    });

    it('should reject withdraws', async () => {
      await expect(tokenMCPool.connect(alice).withdrawToken(tokenMCDepositAmount, Addresses.zero)).to.be.revertedWith(
        'Cannot execute this function during current phase',
      );
    });

    describe('Deposits', async () => {
      it('should mint pool staking tokens on tokenMC deposit', async () => {
        await getTokens(alice, tokenMC, tokenMCDepositAmount);
        await tokenMC.connect(alice).approve(tokenMCPool.address, tokenMCDepositAmount);
        await tokenMCPool.connect(alice).depositToken(tokenMCDepositAmount);

        expect(await tokenMCPool.balanceOf(alice.address)).to.eq(tokenMCDepositAmount);
        expect(await tokenMC.balanceOf(tokenMCPool.address)).to.eq(tokenMCDepositAmount);
        expect(await tokenMCPool.totalSupply()).to.eq(tokenMCDepositAmount);
      });

      it('should mint pool staking tokens on tokenMC2 deposit', async () => {
        await getTokens(bob, tokenMC2, tokenMC2DepositAmount);
        await tokenMC2.connect(bob).approve(tokenMC2Pool.address, tokenMC2DepositAmount);
        await tokenMC2Pool.connect(bob).depositToken(tokenMC2DepositAmount);

        expect(await tokenMC2Pool.balanceOf(bob.address)).to.eq(tokenMC2DepositAmount);
        expect(await tokenMC2.balanceOf(tokenMC2Pool.address)).to.eq(tokenMC2DepositAmount);
        expect(await tokenMC2Pool.totalSupply()).to.eq(tokenMC2DepositAmount);
      });

      it('should mint pool staking tokens on tokenBasic deposit', async () => {
        await getTokens(charlie, tokenBasic, tokenBasicDepositAmount);
        await tokenBasic.connect(charlie).approve(tokenBasicPool.address, tokenBasicDepositAmount);
        await tokenBasicPool.connect(charlie).depositToken(tokenBasicDepositAmount);

        expect(await tokenBasicPool.balanceOf(charlie.address)).to.eq(tokenBasicDepositAmount);
        expect(await tokenBasic.balanceOf(tokenBasicPool.address)).to.eq(tokenBasicDepositAmount);
        expect(await tokenBasicPool.totalSupply()).to.eq(tokenBasicDepositAmount);
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
      await expect(tokenMCPool.connect(alice).depositToken(tokenMCDepositAmount)).to.be.revertedWith(
        'Cannot execute this function during current phase',
      );
    });

    it('should reject withdraws', async () => {
      await expect(tokenMCPool.connect(alice).withdrawToken(tokenMCDepositAmount, Addresses.zero)).to.be.revertedWith(
        'Cannot execute this function during current phase',
      );
    });

    it('should reject pairLiquidity calls from non-vault', async () => {
      await expect(tokenMCPool.pairLiquidity(ethDepositAmount)).to.be.revertedWith('Only Vault');
    });

    it('should reject unpairLiquidity calls from non-vault', async () => {
      await expect(tokenMCPool.unpairLiquidity()).to.be.revertedWith('Only Vault');
    });

    describe('Pair Vaults liquidity', async () => {
      it('should pair and update master chef v1 balances for tokenMC-eth', async () => {
        await vault.pairLiquidityPool(tokenMCPool.address, tokenMCEthAllocation);

        const lpTokensReceived = await tokenMCPool.lpTokenBalance();
        const tokenMCInfo = await masterChef.userInfo(getMasterChefPid(tokenMC.address), tokenMCPool.address);

        expect(tokenMCInfo.amount).to.eq(lpTokensReceived);
      });

      it('should pair and update master chef v2 balances for tokenMC2-weth', async () => {
        await vault.pairLiquidityPool(tokenMC2Pool.address, tokenMC2EthAllocation);

        const lpTokensReceived = await tokenMC2Pool.lpTokenBalance();
        const tokenMC2Info = await masterChefV2.userInfo(getMasterChefPid(tokenMC2.address), tokenMC2Pool.address);

        expect(tokenMC2Info.amount).to.eq(lpTokensReceived);
      });

      it('should pair and update SLP balances for tokenBasic-weth', async () => {
        await vault.pairLiquidityPool(tokenBasicPool.address, tokenBasicEthAllocation);

        const lpTokensReceived = await tokenBasicPool.lpTokenBalance();
        const sushiPair = await getERC20(await tokenBasicPool.pair());

        expect(await sushiPair.balanceOf(tokenBasicPool.address)).to.eq(lpTokensReceived);
      });
    });

    describe('Unpair Vaults Liquidity', async () => {
      before(async () => {
        await mineBlocks(100);
      });

      it('should withdraw tokenMC-weth from master chef and return weth to vault', async () => {
        await vault.unpairLiquidityPool(tokenMCPool.address);

        const tokenMCInfo = await masterChef.userInfo(getMasterChefPid(tokenMC.address), tokenMCPool.address);
        expect(tokenMCInfo.amount).to.eq(0);
        expect(await weth.balanceOf(tokenMCPool.address)).to.eq(0);
      });

      it('should withdraw tokenMC2-weth from master chef and return weth to vault', async () => {
        await vault.unpairLiquidityPool(tokenMC2Pool.address);

        const tokenMC2Info = await masterChefV2.userInfo(getMasterChefPid(tokenMC2.address), tokenMC2Pool.address);
        expect(tokenMC2Info.amount).to.eq(0);
        expect(await weth.balanceOf(tokenMC2Pool.address)).to.eq(0);
      });

      it('should withdraw tokenBasic-weth and return weth to vault', async () => {
        const sushiPair = await getERC20(await tokenBasicPool.pair());
        const lpTokensReceived = await tokenBasicPool.lpTokenBalance();
        expect(await sushiPair.balanceOf(tokenBasicPool.address)).to.eq(lpTokensReceived);

        await vault.unpairLiquidityPool(tokenBasicPool.address);

        expect(await sushiPair.balanceOf(tokenBasicPool.address)).to.eq(0);
        expect(await weth.balanceOf(tokenBasicPool.address)).to.eq(0);
      });
    });
  });

  describe('Phase Two', async () => {
    before(async () => {
      await vault.nextPhase();
    });

    it('should reject deposits', async () => {
      await expect(tokenMCPool.connect(alice).depositToken(tokenMCDepositAmount)).to.be.revertedWith(
        'Cannot execute this function during current phase',
      );
    });

    it('should reject withdraw when withdraw amount exceeds balance', async () => {
      await expect(
        tokenMCPool.connect(alice).withdrawToken(tokenMCDepositAmount.add(1), Addresses.zero),
      ).to.be.revertedWith('Withdraw amount exceeds balance');
    });

    describe('Withdraw', async () => {
      it('should allow users to withdraw part of their balance', async () => {
        const pooltokenMCBalance = await tokenMC.balanceOf(tokenMCPool.address);
        const stakingTokenTotalSupply = await tokenMCPool.totalSupply();
        const aliceStakingTokenBalance = await tokenMCPool.balanceOf(alice.address);
        const aliceWithdrawAmount = aliceStakingTokenBalance.div(2); // withdraw half, migrate half

        await tokenMCPool.connect(alice).withdrawToken(aliceWithdrawAmount, Addresses.zero);

        const alicetokenMCBalanceExpected = pooltokenMCBalance.mul(aliceWithdrawAmount).div(stakingTokenTotalSupply);

        expect(await tokenMC.balanceOf(alice.address)).to.eq(alicetokenMCBalanceExpected);
        expect(await tokenMCPool.balanceOf(alice.address)).to.eq(aliceStakingTokenBalance.sub(aliceWithdrawAmount));
        expect(await tokenMC.balanceOf(tokenMCPool.address)).to.eq(pooltokenMCBalance.sub(alicetokenMCBalanceExpected));
      });

      it('should allow users to withdraw their full balance', async () => {
        const pooltokenMC2Balance = await tokenMC2.balanceOf(tokenMC2Pool.address);
        const stakingTokenTotalSupply = await tokenMC2Pool.totalSupply();
        const bobStakingTokenBalance = await tokenMC2Pool.balanceOf(bob.address);

        await tokenMC2Pool.connect(bob).withdrawToken(bobStakingTokenBalance, Addresses.zero);

        const bobtokenMC2BalanceExpected = pooltokenMC2Balance.mul(bobStakingTokenBalance).div(stakingTokenTotalSupply);

        expect(await tokenMC2.balanceOf(bob.address)).to.eq(bobtokenMC2BalanceExpected);
        expect(await tokenMC2Pool.balanceOf(bob.address)).to.eq(0);
        expect(await tokenMC2.balanceOf(tokenMC2Pool.address)).to.eq(
          pooltokenMC2Balance.sub(bobtokenMC2BalanceExpected),
        );
      });

      it('should allow users to withdraw their full balance', async () => {
        const pooltokenBasicBalance = await tokenBasic.balanceOf(tokenBasicPool.address);
        const stakingTokenTotalSupply = await tokenBasicPool.totalSupply();
        const charlieStakingTokenBalance = await tokenBasicPool.balanceOf(charlie.address);

        await tokenBasicPool.connect(charlie).withdrawToken(charlieStakingTokenBalance, Addresses.zero);

        const charlietokenBasicBalanceExpected = pooltokenBasicBalance
          .mul(charlieStakingTokenBalance)
          .div(stakingTokenTotalSupply);

        expect(await tokenBasic.balanceOf(charlie.address)).to.eq(charlietokenBasicBalanceExpected);
        expect(await tokenBasicPool.balanceOf(charlie.address)).to.eq(0);
        expect(await tokenBasic.balanceOf(tokenBasicPool.address)).to.eq(
          pooltokenBasicBalance.sub(charlietokenBasicBalanceExpected),
        );
      });
    });

    describe('Migrate to V2', async () => {
      it('should reject migrations when amount is greater than their balance', async () => {
        const tokenMCPoolV2: PoolV2Mock = await deployPoolV2(admin, tokenMC.address);
        const aliceStakingTokenBalance = await tokenMCPool.balanceOf(alice.address);
        await expect(
          tokenMCPool.connect(alice).withdrawToken(aliceStakingTokenBalance.add(1), tokenMCPoolV2.address),
        ).to.be.revertedWith('Withdraw amount exceeds balance');
      });

      it('should allow users to migrate their liquidity to v2', async () => {
        const tokenMCPoolV2: PoolV2Mock = await deployPoolV2(admin, tokenMC.address);

        const pooltokenMCBalance = await tokenMC.balanceOf(tokenMCPool.address);
        const aliceStakingTokenBalance = await tokenMCPool.balanceOf(alice.address);
        const alicetokenMCShare = await tokenMCPool.tokenShare(alice.address);

        await tokenMCPool.connect(alice).withdrawToken(aliceStakingTokenBalance, tokenMCPoolV2.address);

        expect(await tokenMCPool.balanceOf(alice.address)).to.eq(0);
        expect(await tokenMC.balanceOf(tokenMCPool.address)).to.eq(pooltokenMCBalance.sub(alicetokenMCShare));
        expect(await tokenMC.balanceOf(tokenMCPoolV2.address)).to.eq(alicetokenMCShare);
        expect(await tokenMCPoolV2.balanceOf(alice.address)).to.eq(alicetokenMCShare);
      });
    });
  });
});
