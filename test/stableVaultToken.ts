import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ERC20, StableVault, StableVaultToken, StableVaultToken__factory } from '../typechain';
import { deployStableVault, getERC20, getTokens } from './utils';
import { Tokens } from './constants';

describe('Rift Stable Vault Token Unit tests', () => {
  const usdcDepositAmount = BigNumber.from(1000).mul(10e6);

  let admin: SignerWithAddress;
  let alice: SignerWithAddress;

  let usdc: ERC20;

  let stableVault: StableVault;
  let usdcSVToken: StableVaultToken;
  let usdtSVToken: StableVaultToken;

  before(async () => {
    const signers: SignerWithAddress[] = await ethers.getSigners();

    [admin, alice] = signers;

    usdc = await getERC20(Tokens.usdc);

    stableVault = await deployStableVault(admin);
    usdcSVToken = StableVaultToken__factory.connect(await stableVault.svUsdc(), ethers.provider);
    usdtSVToken = StableVaultToken__factory.connect(await stableVault.svUsdt(), ethers.provider);
  });

  describe('Deployment', async () => {
    it('should correctly assign erc20 metadata', async () => {
      expect(await usdcSVToken.name()).to.eq('Rift USD Coin Stable Vault Token V1');
      expect(await usdtSVToken.name()).to.eq('Rift Tether USD Stable Vault Token V1');
      expect(await usdcSVToken.symbol()).to.eq('rsvUSDCv1');
      expect(await usdtSVToken.symbol()).to.eq('rsvUSDTv1');
    });
  });

  describe('Phase 0', async () => {
    it('should mint tokens on user deposit to StableVault', async () => {
      await getTokens(alice, usdc, usdcDepositAmount);
      await usdc.connect(alice).approve(stableVault.address, usdcDepositAmount);
      await stableVault.connect(alice).depositToken(usdc.address, usdcDepositAmount);

      expect(await usdcSVToken.connect(admin).balanceOf(alice.address)).to.eq(usdcDepositAmount);
    });

    it('should reject mints not from StableVault', async () => {
      await expect(usdcSVToken.connect(admin).mint(alice.address, usdcDepositAmount)).to.be.revertedWith(
        'Ownable: caller is not the owner',
      );
    });

    it('should reject burns not from StableVault', async () => {
      await expect(usdcSVToken.connect(admin).burn(alice.address, usdcDepositAmount)).to.be.revertedWith(
        'Ownable: caller is not the owner',
      );
    });
  });
});
