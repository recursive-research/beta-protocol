import { expect } from 'chai';
import hre from 'hardhat';
import { BigNumber } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import { Vault, Pool, IERC20 } from '../typechain';
import { deployVault, deployPool, getERC20 } from './utils';
import { Tokens } from './constants';

describe('Rift Pool Unit tests', () => {
  const fixedRate = BigNumber.from('100');

  let admin: SignerWithAddress;

  let sushi: IERC20;

  let vault: Vault;
  let pool: Pool;

  before(async () => {
    // account setup
    const signers: SignerWithAddress[] = await hre.ethers.getSigners();

    admin = signers[0];

    // external contract setup
    sushi = await getERC20(Tokens.Sushi.address);

    // rift contract setup
    vault = await deployVault(admin, fixedRate);
    pool = await deployPool(admin, vault, sushi);
  });

  describe('Deploy Pool', async () => {
    it('should store vault and token address on deployment', async () => {
      expect(await pool.vault()).to.eq(vault.address);
      expect(await pool.token()).to.eq(sushi.address);
    });
  });
});
