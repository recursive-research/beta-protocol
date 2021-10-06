import hre from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumber } from 'ethers';
import { Artifact } from 'hardhat/types';

import { Vault, IERC20, Pool } from '../typechain';
import { deployContract } from 'ethereum-waffle';

// Helper functions to deploy contracts
export async function deployVault(admin: SignerWithAddress, fixedRate: BigNumber, maxEth: BigNumber): Promise<Vault> {
  const vaultArtifact: Artifact = await hre.artifacts.readArtifact('Vault');
  return (await deployContract(admin, vaultArtifact, [fixedRate, maxEth])) as Vault;
}

export async function deployPool(admin: SignerWithAddress, vault: Vault, token: IERC20): Promise<Pool> {
  const poolArtifact: Artifact = await hre.artifacts.readArtifact('Pool');
  return (await deployContract(admin, poolArtifact, [vault.address, token.address])) as Pool;
}

// Helper function to get existing contracts
export async function getERC20(address: string): Promise<IERC20> {
  return await hre.ethers.getContractAt('IERC20', address);
}
