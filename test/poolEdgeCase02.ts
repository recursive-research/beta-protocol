import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import { Vault, ERC20, Pool, IWETH, ERC20__factory } from '../typechain';
import { deployVault, deployPool, getERC20, getTokens, getWETH, mineBlock } from './utils';
import { Addresses, Tokens } from './constants';

describe('Rift Pool Edge Case - Exact Fixed Rate returned', () => {
  const fixedRate = BigNumber.from('0');
  const maxEth = ethers.utils.parseEther('50');

  const ethDepositAmount = ethers.utils.parseEther('1');
  const aaveDepositAmount = ethers.utils.parseEther('1');

  let admin: SignerWithAddress;
  let alice: SignerWithAddress;

  let weth: IWETH;
  let aave: ERC20;

  let vault: Vault;
  let aavePool: Pool;

  before(async () => {
    // account setup
    const signers: SignerWithAddress[] = await ethers.getSigners();

    [admin, alice] = signers;

    // external contract setup
    weth = await getWETH();
    aave = await getERC20(Tokens.aave);

    // rift contract setup
    vault = await deployVault(admin, fixedRate, maxEth);
    aavePool = await deployPool(admin, vault, aave);
  });

  describe('Deposit into Pool', async () => {
    it('should mint pool staking tokens on aave deposit', async () => {
      await getTokens(alice, aave, aaveDepositAmount);
      await aave.connect(alice).approve(aavePool.address, aaveDepositAmount);
      await aavePool.connect(alice).depositToken(aaveDepositAmount);

      expect(await aavePool.balanceOf(alice.address)).to.eq(aaveDepositAmount);
      expect(await aave.balanceOf(aavePool.address)).to.eq(aaveDepositAmount);
      expect(await aavePool.totalSupply()).to.eq(aaveDepositAmount);
    });
  });

  describe('Deposit Eth', async () => {
    before(async () => {
      await vault.connect(alice).depositEth({ value: ethDepositAmount });
      await vault.nextPhase();
      await vault.wrapEth();
    });

    it('should pair aave-weth', async () => {
      await vault.pairLiquidityPool(aavePool.address, aaveDepositAmount, 0, 0);
      const pair: ERC20 = ERC20__factory.connect(await aavePool.pair(), ethers.provider);
      const lpTokenBalance = await pair.balanceOf(aavePool.address);
      expect(await aavePool.lpTokenBalance()).to.eq(lpTokenBalance);
      await mineBlock();
    });
  });

  describe('Unpair Vaults Liquidity', async () => {
    it('should return weth when weth balance == weth owed', async () => {
      // when we add liquidity in the aave weth pool and then remove it, we end up
      // with 99.99999% of the original balance. We're trying to test the case where
      // the returned ETH amount == the owed amount, so we force it by sending the contract
      // 1 wei
      await getTokens(aavePool, weth, ethers.BigNumber.from(1));
      await vault.unpairLiquidityPool(aavePool.address, 0, 0);
      expect(await weth.balanceOf(aavePool.address)).to.eq(0);
    });
  });

  describe('Withdraw', async () => {
    before(async () => {
      await vault.unwrapEth();
      await vault.nextPhase();
    });
    it('should allow users to withdraw original deposits', async () => {
      expect(await ethers.provider.getBalance(vault.address)).to.eq(ethDepositAmount);
      await vault.connect(alice).withdrawEth(Addresses.zero);

      expect(await ethers.provider.getBalance(vault.address)).to.eq(0);
    });
  });
});
