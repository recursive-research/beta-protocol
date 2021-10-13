import { expect } from 'chai';
import { BigNumber } from 'ethers';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import { deployPool, deployVault, deployVaultV2, getERC20, getTokens, getWETH } from './utils';
import { Vault, ERC20, Pool, IWETH, VaultV2Mock } from '../typechain';
import { Addresses, Tokens } from './constants';

describe('Rift Vault Unit tests', () => {
  const tokenName = 'RIFT - Fixed Rate ETH V1';
  const tokenSymbol = 'riftETHv1';

  const fixedRate = BigNumber.from('5');
  const newFixedRate = BigNumber.from('10');

  const maxEth = ethers.utils.parseEther('10');
  const newMaxEth = ethers.utils.parseEther('20');

  const ethDepositAmount = ethers.utils.parseEther('1');
  const ethDepositAmountOverflow = ethers.utils.parseEther('11');
  const tokenDepositAmount = ethers.utils.parseEther('1');

  let admin: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  let token: ERC20;
  let weth: IWETH;

  let vault: Vault;
  let pool: Pool;
  let vaultV2: VaultV2Mock;

  before(async () => {
    // account setup
    const signers: SignerWithAddress[] = await ethers.getSigners();
    [admin, alice, bob] = signers;

    // external contract setup
    token = await getERC20(Tokens.yfi);
    weth = await getWETH();
  });

  describe('Deployment', async () => {
    beforeEach(async () => {
      vault = await deployVault(admin, fixedRate, maxEth);
      pool = await deployPool(admin, vault, token);
    });

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

    it('should be in phase zero on initialization', async () => {
      expect(await vault.phase()).to.eq(0);
    });
  });

  describe('Phase 0', async () => {
    beforeEach(async () => {
      vault = await deployVault(admin, fixedRate, maxEth);
      pool = await deployPool(admin, vault, token);
    });

    it('should reject maxEth updates from non owner', async () => {
      await expect(vault.connect(alice).updateMaxEth(newMaxEth)).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('should allow owner to update maxEth', async () => {
      await vault.updateMaxEth(newMaxEth);
      expect(await vault.maxEth()).to.eq(newMaxEth);
    });

    it('should reject fixed rate updates from non owner', async () => {
      await expect(vault.connect(alice).updateFixedRate(newFixedRate)).to.be.revertedWith(
        'Ownable: caller is not the owner',
      );
    });

    it('should allow owner to update fixed rate', async () => {
      await vault.updateFixedRate(newFixedRate);
      expect(await vault.fixedRate()).to.eq(newFixedRate);
    });

    it('should allow owner to move to phase 1', async () => {
      await vault.nextPhase();
      expect(await vault.phase()).to.eq(1);
    });

    it('should mint user tokens on ETH deposit', async () => {
      await vault.connect(alice).depositEth({ value: ethDepositAmount });

      expect(await vault.balanceOf(alice.address)).to.eq(ethDepositAmount);
      expect(await ethers.provider.getBalance(vault.address)).to.eq(ethDepositAmount);
      expect(await vault.totalSupply()).to.eq(ethDepositAmount);
    });

    it('should emit event on user ETH deposit', async () => {
      await expect(vault.connect(alice).depositEth({ value: ethDepositAmount }))
        .to.emit(vault, 'Deposit')
        .withArgs(alice.address, ethDepositAmount);
    });

    it('should mint user tokens on WETH deposit', async () => {
      await weth.connect(alice).deposit({ value: ethDepositAmount });
      await weth.connect(alice).approve(vault.address, ethDepositAmount);

      await vault.connect(alice).depositWeth(ethDepositAmount);

      expect(await vault.balanceOf(alice.address)).to.eq(ethDepositAmount);
      expect(await weth.balanceOf(vault.address)).to.eq(ethDepositAmount);
      expect(await vault.totalSupply()).to.eq(ethDepositAmount);
    });

    it('should emit event on wETH deposit', async () => {
      await weth.connect(alice).deposit({ value: ethDepositAmount });
      await weth.connect(alice).approve(vault.address, ethDepositAmount);

      await expect(vault.connect(alice).depositWeth(ethDepositAmount))
        .to.emit(vault, 'Deposit')
        .withArgs(alice.address, ethDepositAmount);
    });

    it('should reject eth deposits that overflow maxEth', async () => {
      await expect(vault.connect(alice).depositEth({ value: ethDepositAmountOverflow })).to.be.revertedWith(
        'Max eth cap has been hit',
      );
    });

    it('should reject weth deposits that overflow maxEth', async () => {
      await expect(vault.connect(alice).depositWeth(ethDepositAmountOverflow)).to.be.revertedWith(
        'Max eth cap has been hit',
      );
    });

    it('should reject withdraws', async () => {
      await expect(vault.connect(alice).withdrawEth(Addresses.zero)).to.be.revertedWith(
        'Cannot execute this function during current phase',
      );
    });

    it('should allow owner to move to phase 1', async () => {
      await vault.nextPhase();
      expect(await vault.phase()).to.eq(1);
    });
  });

  describe('Phase 1', async () => {
    beforeEach(async () => {
      vault = await deployVault(admin, fixedRate, maxEth);
      pool = await deployPool(admin, vault, token);

      await vault.connect(alice).depositEth({ value: ethDepositAmount });
      await getTokens(alice, token, tokenDepositAmount);
      await token.connect(alice).approve(pool.address, tokenDepositAmount);

      await pool.connect(alice).depositToken(tokenDepositAmount);
      await vault.nextPhase();
    });

    it('should reject withdraws', async () => {
      await expect(vault.connect(alice).withdrawEth(Addresses.zero)).to.be.revertedWith(
        'Cannot execute this function during current phase',
      );
    });

    it('should reject eth deposits', async () => {
      await expect(vault.connect(alice).depositEth({ value: ethDepositAmount })).to.be.revertedWith(
        'Cannot execute this function during current phase',
      );
    });

    it('should reject weth deposits', async () => {
      await expect(vault.connect(alice).depositWeth(ethDepositAmount)).to.be.revertedWith(
        'Cannot execute this function during current phase',
      );
    });

    it('should reject owner updating maxEth', async () => {
      await expect(vault.updateMaxEth(newMaxEth.mul(2))).to.be.revertedWith(
        'Cannot execute this function during current phase',
      );
    });

    it('should reject wrapEth calls from non owner', async () => {
      await expect(vault.connect(alice).wrapEth()).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('should allow owner to wrap eth', async () => {
      expect(await weth.balanceOf(vault.address)).to.eq(0);
      expect(await ethers.provider.getBalance(vault.address)).to.eq(ethDepositAmount);

      await vault.wrapEth();

      expect(await weth.balanceOf(vault.address)).to.eq(ethDepositAmount);
      expect(await ethers.provider.getBalance(vault.address)).to.eq(0);
    });

    describe('deploying liquidity', async () => {
      beforeEach(async () => {
        await vault.wrapEth();
      });

      it('should reject pairLiquidityPool calls from non owner', async () => {
        await expect(vault.connect(alice).pairLiquidityPool(pool.address, ethDepositAmount, 1, 1)).to.be.revertedWith(
          'Ownable: caller is not the owner',
        );
      });

      it('should allow owner to call pairLiquidityPool', async () => {
        expect(await weth.balanceOf(vault.address)).to.eq(ethDepositAmount);

        await vault.pairLiquidityPool(pool.address, ethDepositAmount, 1, 1);

        expect(await weth.balanceOf(vault.address)).to.eq(0);
      });

      it('should emit event when owner calls pairLiquidityPool', async () => {
        await expect(vault.pairLiquidityPool(pool.address, ethDepositAmount, 1, 1))
          .to.emit(vault, 'LiquidityDeployed')
          .withArgs(pool.address, ethDepositAmount);
      });
    });

    describe('withdrawing liquidity', async () => {
      beforeEach(async () => {
        await vault.wrapEth();
        await vault.pairLiquidityPool(pool.address, ethDepositAmount, 1, 1);
      });

      it('should reject unpairLiquidityPool calls from non owner', async () => {
        await expect(vault.connect(alice).unpairLiquidityPool(pool.address, 1, 1)).to.be.revertedWith(
          'Ownable: caller is not the owner',
        );
      });

      it('should allow owner to unpairLiquidityPool', async () => {
        expect(await weth.balanceOf(vault.address)).to.eq(0);

        await vault.unpairLiquidityPool(pool.address, 1, 1);

        expect(await weth.balanceOf(vault.address)).to.be.gt(ethDepositAmount);
      });

      it('should emit event on unpairLiquidityPool call', async () => {
        await expect(vault.unpairLiquidityPool(pool.address, 1, 1))
          .to.emit(vault, 'LiquidityReturned')
          .withArgs(pool.address);
      });
    });

    describe('ending phase 1', async () => {
      beforeEach(async () => {
        await vault.wrapEth();
        await vault.pairLiquidityPool(pool.address, ethDepositAmount, 1, 1);
        await vault.unpairLiquidityPool(pool.address, 1, 1);
      });

      it('should reject unwrapEth calls from non owner', async () => {
        await expect(vault.connect(alice).unwrapEth()).to.be.revertedWith('Ownable: caller is not the owner');
      });

      it('should allow owner to unwrap eth', async () => {
        expect(await ethers.provider.getBalance(vault.address)).to.eq(0);
        const wethBalance = await weth.balanceOf(vault.address);

        await vault.unwrapEth();

        expect(await weth.balanceOf(vault.address)).to.eq(0);
        expect(await ethers.provider.getBalance(vault.address)).to.eq(wethBalance);
      });

      it('should allow owner to move to phase 2', async () => {
        await vault.nextPhase();
        expect(await vault.phase()).to.eq(2);
      });
    });
  });

  describe('Phase Two', async () => {
    beforeEach(async () => {
      vault = await deployVault(admin, fixedRate, maxEth);
      pool = await deployPool(admin, vault, token);

      await vault.connect(alice).depositEth({ value: ethDepositAmount });
      await getTokens(alice, token, tokenDepositAmount);
      await token.connect(alice).approve(pool.address, tokenDepositAmount);
      await pool.connect(alice).depositToken(tokenDepositAmount);

      await vault.nextPhase();

      await vault.wrapEth();
      await vault.pairLiquidityPool(pool.address, ethDepositAmount, 1, 1);
      await vault.unpairLiquidityPool(pool.address, 1, 1);
      await vault.unwrapEth();

      await vault.nextPhase();
    });

    it('should reject users depositing ETH', async () => {
      await expect(vault.connect(alice).depositEth({ value: ethDepositAmount })).to.be.revertedWith(
        'Cannot execute this function during current phase',
      );
    });

    it('should reject users depositing weth', async () => {
      await expect(vault.connect(alice).depositWeth(ethDepositAmount)).to.be.revertedWith(
        'Cannot execute this function during current phase',
      );
    });

    it('should reject owner updating maxEth', async () => {
      await expect(vault.updateMaxEth(newMaxEth.mul(2))).to.be.revertedWith(
        'Cannot execute this function during current phase',
      );
    });

    it('should allow users to view their withdrawable balance', async () => {
      const vaultEthBalance = await ethers.provider.getBalance(vault.address);
      expect(await vault.ethShare(alice.address)).to.eq(vaultEthBalance);
    });

    describe('Withdraw', async () => {
      it('should reject withdraw when user has no balance', async () => {
        await expect(vault.connect(bob).withdrawEth(Addresses.zero)).to.be.revertedWith('User has no balance');
      });

      it('should allow users to withdraw proportional share', async () => {
        const vaultEthBalance = await ethers.provider.getBalance(vault.address);
        const aliceEthBalanceInitial = await ethers.provider.getBalance(alice.address);

        await vault.connect(alice).withdrawEth(Addresses.zero);

        const aliceEthBalanceFinal = await ethers.provider.getBalance(alice.address);
        const aliceEthBalanceIncrease = aliceEthBalanceFinal.sub(aliceEthBalanceInitial);

        expect(aliceEthBalanceIncrease).to.be.gt(vaultEthBalance.mul(99).div(100));
        expect(await vault.balanceOf(alice.address)).to.eq(0);
        expect(await ethers.provider.getBalance(vault.address)).to.eq(0);
      });

      it('should emit event on user withdraw', async () => {
        const vaultEthBalance = await ethers.provider.getBalance(vault.address);
        await expect(vault.connect(alice).withdrawEth(Addresses.zero))
          .to.emit(vault, 'Withdraw')
          .withArgs(alice.address, vaultEthBalance);
      });
    });

    describe('Migrations to V2', async () => {
      beforeEach(async () => {
        vaultV2 = await deployVaultV2(admin);
      });
      it('should reject migration to v2 after user has withdrawn', async () => {
        await vault.connect(alice).withdrawEth(Addresses.zero);
        expect(await vault.balanceOf(alice.address)).to.eq(0);

        await expect(vault.connect(alice).withdrawEth(vaultV2.address)).to.be.revertedWith('User has no balance');
      });

      it('should allow users to migrate their eth to V2', async () => {
        const vaultEthBalance = await ethers.provider.getBalance(vault.address);

        await vault.connect(alice).withdrawEth(vaultV2.address);

        expect(await vault.balanceOf(alice.address)).to.eq(0);
        expect(await ethers.provider.getBalance(vault.address)).to.eq(0);
        expect(await ethers.provider.getBalance(vaultV2.address)).to.eq(vaultEthBalance);
        expect(await vaultV2.balanceOf(alice.address)).to.eq(vaultEthBalance);
      });

      it('should emit event on successful migration', async () => {
        const vaultEthBalance = await ethers.provider.getBalance(vault.address);
        await expect(vault.connect(alice).withdrawEth(vaultV2.address))
          .to.emit(vault, 'Migration')
          .withArgs(alice.address, vaultEthBalance);
      });
    });
  });
});
