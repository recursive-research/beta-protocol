import { expect } from 'chai';
import { BigNumber } from 'ethers';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import { deployPool, deployVault, deployVaultV2, getERC20, getTokens, getWETH, mineBlocks } from './utils';
import { Vault, ERC20, Pool, IWETH, VaultV2Mock } from '../typechain';
import { Addresses, Tokens } from './constants';

describe('Rift Vault Unit tests', () => {
  const tokenName = 'RIFT - Fixed Rate ETH V1';
  const tokenSymbol = 'riftETHv1';
  const fixedRate = BigNumber.from('5');
  const newFixedRate = BigNumber.from('10');
  const ethDepositAmount = ethers.utils.parseEther('4');
  const yfiDepositAmount = ethers.utils.parseEther('100');
  const maxEth = ethers.utils.parseEther('10');
  const newMaxEth = ethers.utils.parseEther('20');

  let admin: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  let yfi: ERC20;
  let weth: IWETH;

  let vault: Vault;
  let pool: Pool;

  before(async () => {
    // account setup
    const signers: SignerWithAddress[] = await ethers.getSigners();
    [admin, alice, bob] = signers;

    // external contract setup
    yfi = await getERC20(Tokens.yfi);
    weth = await getWETH();

    // contract setup
    vault = await deployVault(admin, fixedRate, maxEth);
    pool = await deployPool(admin, vault, yfi);
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

    it('should reject maxEth updates from non owner', async () => {
      await expect(vault.connect(alice).updateMaxEth(newMaxEth)).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('should allow owner to update fixed rate', async () => {
      await vault.updateFixedRate(newFixedRate);

      expect(await vault.fixedRate()).to.eq(newFixedRate);
    });

    describe('Deposits', async () => {
      it('should mint user tokens on ETH deposit', async () => {
        await expect(vault.connect(alice).depositEth({ value: ethDepositAmount }))
          .to.emit(vault, 'Deposit')
          .withArgs(alice.address, ethDepositAmount);

        expect(await vault.balanceOf(alice.address)).to.eq(ethDepositAmount);
        expect(await ethers.provider.getBalance(vault.address)).to.eq(ethDepositAmount);
        expect(await vault.totalSupply()).to.eq(ethDepositAmount);
      });

      it('should mint user tokens on wETH deposit', async () => {
        await weth.connect(alice).deposit({ value: ethDepositAmount });
        await weth.connect(alice).approve(vault.address, ethDepositAmount);

        await expect(vault.connect(alice).depositWeth(ethDepositAmount))
          .to.emit(vault, 'Deposit')
          .withArgs(alice.address, ethDepositAmount);

        expect(await vault.balanceOf(alice.address)).to.eq(ethDepositAmount.mul(2));
        expect(await weth.balanceOf(vault.address)).to.eq(ethDepositAmount);
        expect(await vault.totalSupply()).to.eq(ethDepositAmount.mul(2));
      });

      it('should reject eth deposits that overflow maxEth', async () => {
        await expect(vault.connect(bob).depositEth({ value: ethDepositAmount })).to.be.revertedWith(
          'Max eth cap has been hit',
        );
        expect(await vault.totalSupply()).to.eq(ethDepositAmount.mul(2));
      });

      it('should reject weth deposits that overflow maxEth', async () => {
        await expect(vault.connect(bob).depositWeth(ethDepositAmount)).to.be.revertedWith('Max eth cap has been hit');
        expect(await vault.totalSupply()).to.eq(ethDepositAmount.mul(2));
      });

      it('should allow owner to update maxEth', async () => {
        await vault.updateMaxEth(newMaxEth);
        expect(await vault.maxEth()).to.eq(newMaxEth);
      });

      it('should allow a user to deposit eth after cap has been raised', async () => {
        await vault.connect(bob).depositEth({ value: ethDepositAmount });

        expect(await vault.balanceOf(bob.address)).to.eq(ethDepositAmount);
        expect(await ethers.provider.getBalance(vault.address)).to.eq(ethDepositAmount.mul(2));
        expect(await vault.totalSupply()).to.eq(ethDepositAmount.mul(3));
      });

      it('should allow a user to deposit weth after cap has been raised', async () => {
        await weth.connect(bob).deposit({ value: ethDepositAmount });
        await weth.connect(bob).approve(vault.address, ethDepositAmount);
        await vault.connect(bob).depositWeth(ethDepositAmount);

        expect(await vault.balanceOf(bob.address)).to.eq(ethDepositAmount.mul(2));
        expect(await weth.balanceOf(vault.address)).to.eq(ethDepositAmount.mul(2));
        expect(await vault.totalSupply()).to.eq(ethDepositAmount.mul(4));
      });
    });

    it('should reject withdraw', async () => {
      await expect(vault.connect(alice).withdrawEth(Addresses.zero)).to.be.revertedWith(
        'Cannot execute this function during current phase',
      );
    });
  });

  describe('Phase One', async () => {
    before(async () => {
      // setting up yfi deposits into pool for phase 2
      await getTokens(alice, yfi, yfiDepositAmount);
      await yfi.connect(alice).approve(pool.address, yfiDepositAmount);
      await pool.connect(alice).depositToken(yfiDepositAmount);
    });

    it('should reject phase update from non owner', async () => {
      await expect(vault.connect(alice).nextPhase()).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('should allow owner to move to phase 1', async () => {
      await vault.nextPhase();
      expect(await vault.phase()).to.eq(1);
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

    it('should reject withdraw', async () => {
      await expect(vault.connect(alice).withdrawEth(Addresses.zero)).to.be.revertedWith(
        'Cannot execute this function during current phase',
      );
    });

    it('should reject owner updating maxEth', async () => {
      await expect(vault.updateMaxEth(newMaxEth.mul(2))).to.be.revertedWith(
        'Cannot execute this function during current phase',
      );
    });

    describe('deploying liquidity', async () => {
      it('should reject wrapEth calls from non owner', async () => {
        await expect(vault.connect(alice).wrapEth()).to.be.revertedWith('Ownable: caller is not the owner');
      });

      it('should allow owner to wrap eth', async () => {
        expect(await weth.balanceOf(vault.address)).to.eq(ethDepositAmount.mul(2));
        expect(await ethers.provider.getBalance(vault.address)).to.eq(ethDepositAmount.mul(2));

        await vault.wrapEth();

        expect(await weth.balanceOf(vault.address)).to.eq(ethDepositAmount.mul(4));
        expect(await ethers.provider.getBalance(vault.address)).to.eq(0);
      });

      it('should reject pairLiquidityPool calls from non owner', async () => {
        await expect(vault.connect(alice).pairLiquidityPool(pool.address, ethDepositAmount)).to.be.revertedWith(
          'Ownable: caller is not the owner',
        );
      });

      it('should allow owner to call pairLiquidityPool', async () => {
        expect(await weth.balanceOf(vault.address)).to.eq(ethDepositAmount.mul(4));

        await expect(vault.pairLiquidityPool(pool.address, ethDepositAmount.mul(4)))
          .to.emit(vault, 'LiquidityDeployed')
          .withArgs(pool.address, ethDepositAmount.mul(4));

        expect(await weth.balanceOf(vault.address)).to.eq(0);
      });
    });

    describe('withdrawing liquidity', async () => {
      before(async () => {
        await mineBlocks(100);
      });

      it('should reject unpairLiquidityPool calls from non owner', async () => {
        await expect(vault.connect(alice).unpairLiquidityPool(pool.address)).to.be.revertedWith(
          'Ownable: caller is not the owner',
        );
      });

      it('should allow owner to unpairLiquidityPool', async () => {
        const initialWethBalance = await weth.balanceOf(vault.address);

        await expect(vault.unpairLiquidityPool(pool.address))
          .to.emit(vault, 'LiquidityReturned')
          .withArgs(pool.address);

        expect(await weth.balanceOf(vault.address)).to.be.gt(initialWethBalance);
      });

      it('should reject unwrapEth calls from non owner', async () => {
        await expect(vault.connect(alice).unwrapEth()).to.be.revertedWith('Ownable: caller is not the owner');
      });

      it('should allow owner to unwrap eth', async () => {
        const ethBalance = await ethers.provider.getBalance(vault.address);
        const wethBalance = await weth.balanceOf(vault.address);

        await vault.unwrapEth();

        expect(await weth.balanceOf(vault.address)).to.eq(0);
        expect(await ethers.provider.getBalance(vault.address)).to.eq(ethBalance.add(wethBalance));
      });
    });
  });

  describe('Phase Two', async () => {
    it('should reject phase update from non owner', async () => {
      await expect(vault.connect(alice).nextPhase()).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('should allow owner to move to phase 2', async () => {
      await vault.nextPhase();
      expect(await vault.phase()).to.eq(2);
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

    describe('Withdraw', async () => {
      it('should reject withdraw when user has no balance', async () => {
        await expect(vault.connect(admin).withdrawEth(Addresses.zero)).to.be.revertedWith('User has no balance');
      });

      it('should allow users to withdraw proportional share', async () => {
        const vaultEthBalance = await ethers.provider.getBalance(vault.address);
        const stakingTokenTotalSupply = await vault.totalSupply();
        const aliceStakingTokenBalance = await vault.balanceOf(alice.address);
        const aliceEthBalanceInitial = await ethers.provider.getBalance(alice.address);
        const aliceEthShare = vaultEthBalance.mul(aliceStakingTokenBalance).div(stakingTokenTotalSupply);

        await expect(vault.connect(alice).withdrawEth(Addresses.zero))
          .to.emit(vault, 'Withdraw')
          .withArgs(alice.address, aliceEthShare);

        const aliceEthBalanceFinal = await ethers.provider.getBalance(alice.address);
        const aliceEthBalanceIncrease = aliceEthBalanceFinal.sub(aliceEthBalanceInitial);

        expect(aliceEthBalanceIncrease).to.be.gt(aliceEthShare.mul(99).div(100));
        expect(await vault.balanceOf(alice.address)).to.eq(0);
        expect(await ethers.provider.getBalance(vault.address)).to.eq(vaultEthBalance.sub(aliceEthShare));
      });
    });

    describe('Migrations to V2', async () => {
      it('should reject migration to v2 after user has withdrawn', async () => {
        const vaultV2: VaultV2Mock = await deployVaultV2(admin);
        expect(await vault.balanceOf(alice.address)).to.eq(0);

        await expect(vault.connect(alice).withdrawEth(vaultV2.address)).to.be.revertedWith('User has no balance');
      });

      it('should allow users to migrate their eth to V2', async () => {
        const vaultV2: VaultV2Mock = await deployVaultV2(admin);

        const vaultEthBalance = await ethers.provider.getBalance(vault.address);
        const vaultV2EthBalance = await ethers.provider.getBalance(vaultV2.address);
        const bobEthShare = await vault.ethShare(bob.address);

        await expect(vault.connect(bob).withdrawEth(vaultV2.address))
          .to.emit(vault, 'Migration')
          .withArgs(bob.address, bobEthShare);

        expect(await vault.balanceOf(bob.address)).to.eq(0);
        expect(await ethers.provider.getBalance(vault.address)).to.eq(vaultEthBalance.sub(bobEthShare));
        expect(await ethers.provider.getBalance(vault.address)).to.eq(0);
        expect(await ethers.provider.getBalance(vaultV2.address)).to.eq(vaultV2EthBalance.add(bobEthShare));
        expect(await vaultV2.balanceOf(bob.address)).to.eq(bobEthShare);
      });
    });
  });
});
