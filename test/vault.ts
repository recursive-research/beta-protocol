import { expect } from 'chai';
import { BigNumber } from 'ethers';
import hre, { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import { deploySushiPool, deployVault, deployVaultV2, getERC20, getTokens, getWETH } from './utils';
import { Vault, ERC20, IWETH, VaultV2Mock, SushiPool } from '../typechain';
import { Addresses, Tokens } from './constants';
import { Artifact } from 'hardhat/types';
import { deployContract } from 'ethereum-waffle';

describe('Rift Vault Unit tests', () => {
  const tokenName = 'RIFT - Fixed Rate ETH V1';
  const tokenSymbol = 'riftETHv1';

  const fixedRate = BigNumber.from('5'); // out of 1000

  const ethDepositAmount = ethers.utils.parseEther('1');
  const tokenDepositAmount = ethers.utils.parseEther('1');

  let admin: SignerWithAddress;
  let alice: SignerWithAddress;

  let token: ERC20;
  let weth: IWETH;

  let vault: Vault;
  let pool: SushiPool;
  let vaultV2: VaultV2Mock;

  before(async () => {
    // account setup
    const signers: SignerWithAddress[] = await ethers.getSigners();
    [admin, alice] = signers;

    // external contract setup
    token = await getERC20(Tokens.yfi);
    weth = await getWETH();
  });

  describe('Deployment', async () => {
    beforeEach(async () => {
      vault = await deployVault(admin);
      pool = await deploySushiPool(admin, vault, token, fixedRate);
    });

    it('should reject deployment with invalid weth address', async () => {
      const vaultArtifact: Artifact = await hre.artifacts.readArtifact('Vault');
      await expect(deployContract(admin, vaultArtifact, [Addresses.zero])).to.be.revertedWith('Invalid weth');
    });

    it('should allow pool registration', async () => {
      await vault.registerPool(pool.address);
      expect(await vault.poolToToken(pool.address)).to.eq(token.address);
    });

    it('should reject pool registration of already valid pool', async () => {
      await vault.registerPool(pool.address);
      await expect(vault.registerPool(pool.address)).to.be.revertedWith('Already registered');
    });

    it('should reject pool registration of zero address', async () => {
      await expect(vault.registerPool(Addresses.zero)).to.be.revertedWith('Invalid pool');
    });

    it('should correctly assign erc20 metadata', async () => {
      expect(await vault.name()).to.eq(tokenName);
      expect(await vault.symbol()).to.eq(tokenSymbol);
    });

    it('should mint no tokens on deployment', async () => {
      expect(await vault.totalSupply()).to.eq(0);
    });

    it('should be in phase zero on initialization', async () => {
      expect(await vault.phase()).to.eq(0);
    });
  });

  describe('Phase 0', async () => {
    beforeEach(async () => {
      vault = await deployVault(admin);
      pool = await deploySushiPool(admin, vault, token, fixedRate);
      await vault.registerPool(pool.address);
    });

    it('should reject pairLiquidityPool call', async () => {
      await expect(
        vault.pairLiquidityPool(pool.address, ethDepositAmount, tokenDepositAmount, 0, 0),
      ).to.be.revertedWith('Invalid Phase function');
    });

    it('should reject unpairLiquidityPool call', async () => {
      await expect(vault.unpairLiquidityPool(pool.address, 0, 0)).to.be.revertedWith('Invalid Phase function');
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

    it('should allow owner to move to phase 1', async () => {
      await vault.nextPhase();
      expect(await vault.phase()).to.eq(1);
    });
  });

  describe('Phase 1', async () => {
    beforeEach(async () => {
      vault = await deployVault(admin);
      pool = await deploySushiPool(admin, vault, token, fixedRate);
      await vault.registerPool(pool.address);

      await vault.connect(alice).depositEth({ value: ethDepositAmount });
      await getTokens(alice, token, tokenDepositAmount);
      await token.connect(alice).approve(pool.address, tokenDepositAmount);

      await pool.connect(alice).depositToken(tokenDepositAmount);
      await vault.nextPhase();
    });

    it('should reject eth deposits', async () => {
      await expect(vault.connect(alice).depositEth({ value: ethDepositAmount })).to.be.revertedWith(
        'Invalid Phase function',
      );
    });

    it('should reject weth deposits', async () => {
      await expect(vault.connect(alice).depositWeth(ethDepositAmount)).to.be.revertedWith('Invalid Phase function');
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

      it('should reject pairLiquidity call for unregistered pool', async () => {
        const newPool = await deploySushiPool(admin, vault, token, fixedRate);

        await expect(vault.pairLiquidityPool(newPool.address, 1, 1, 0, 0)).to.be.revertedWith('Invalid pool');
      });

      it('should reject pairLiquidityPool calls from non owner', async () => {
        await expect(
          vault.connect(alice).pairLiquidityPool(pool.address, ethDepositAmount, tokenDepositAmount, 0, 0),
        ).to.be.revertedWith('Ownable: caller is not the owner');
      });

      it('should allow owner to call pairLiquidityPool', async () => {
        expect(await weth.balanceOf(vault.address)).to.eq(ethDepositAmount);

        await vault.pairLiquidityPool(pool.address, ethDepositAmount, tokenDepositAmount, 1, 1);

        expect(await weth.balanceOf(vault.address)).to.eq(0);
      });

      it('should emit event when owner calls pairLiquidityPool', async () => {
        await expect(vault.pairLiquidityPool(pool.address, ethDepositAmount, tokenDepositAmount, 1, 1))
          .to.emit(vault, 'LiquidityDeployed')
          .withArgs(pool.address, ethDepositAmount);
      });
    });

    describe('withdrawing liquidity', async () => {
      beforeEach(async () => {
        await vault.wrapEth();
        await vault.pairLiquidityPool(pool.address, ethDepositAmount, tokenDepositAmount, 1, 1);
      });

      it('should reject unpairLiquidityPool calls from non owner', async () => {
        await expect(vault.connect(alice).unpairLiquidityPool(pool.address, 1, 1)).to.be.revertedWith(
          'Ownable: caller is not the owner',
        );
      });

      it('should reject unpairLiquidityPool call for unregistered pool', async () => {
        const newPool = await deploySushiPool(admin, vault, token, fixedRate);
        await expect(vault.unpairLiquidityPool(newPool.address, 0, 0)).to.be.revertedWith('Invalid pool');
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
        await vault.pairLiquidityPool(pool.address, ethDepositAmount, tokenDepositAmount, 1, 1);
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
      vault = await deployVault(admin);
      pool = await deploySushiPool(admin, vault, token, fixedRate);
      await vault.registerPool(pool.address);

      await vault.connect(alice).depositEth({ value: ethDepositAmount });
      await getTokens(alice, token, tokenDepositAmount);
      await token.connect(alice).approve(pool.address, tokenDepositAmount);
      await pool.connect(alice).depositToken(tokenDepositAmount);

      await vault.nextPhase();

      await vault.wrapEth();
      await vault.pairLiquidityPool(pool.address, ethDepositAmount, tokenDepositAmount, 1, 1);
      await vault.unpairLiquidityPool(pool.address, 1, 1);
      await vault.unwrapEth();

      await vault.nextPhase();
    });

    it('should reject pairLiquidityPool call', async () => {
      await expect(
        vault.pairLiquidityPool(pool.address, ethDepositAmount, tokenDepositAmount, 0, 0),
      ).to.be.revertedWith('Invalid Phase function');
    });

    it('should reject unpairLiquidityPool call', async () => {
      await expect(vault.unpairLiquidityPool(pool.address, 0, 0)).to.be.revertedWith('Invalid Phase function');
    });

    it('should reject users depositing ETH', async () => {
      await expect(vault.connect(alice).depositEth({ value: ethDepositAmount })).to.be.revertedWith(
        'Invalid Phase function',
      );
    });

    it('should reject users depositing weth', async () => {
      await expect(vault.connect(alice).depositWeth(ethDepositAmount)).to.be.revertedWith('Invalid Phase function');
    });

    it('should reject moving to phase 3', async () => {
      await expect(vault.nextPhase()).to.be.revertedWith('Invalid next phase');
    });

    describe('Migrations to V2', async () => {
      beforeEach(async () => {
        vaultV2 = await deployVaultV2(admin, vault.address);
      });

      it('should reject migration from non owner', async () => {
        await expect(vault.connect(alice).migrateLiquidity(vaultV2.address)).to.be.revertedWith(
          'Ownable: caller is not the owner',
        );
      });

      it('should allow migrator to migrate liquidity to V2', async () => {
        const vaultEthBalance = await ethers.provider.getBalance(vault.address);

        await vault.migrateLiquidity(vaultV2.address);

        expect(await ethers.provider.getBalance(vault.address)).to.eq(0);
        expect(await ethers.provider.getBalance(vaultV2.address)).to.eq(vaultEthBalance);
      });

      it('should emit event on successful migration', async () => {
        const vaultEthBalance = await ethers.provider.getBalance(vault.address);
        await expect(vault.migrateLiquidity(vaultV2.address))
          .to.emit(vault, 'Migration')
          .withArgs(vaultV2.address, vaultEthBalance);
      });
    });
  });
});
