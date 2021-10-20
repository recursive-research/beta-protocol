import hre from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumber } from 'ethers';
import { Artifact } from 'hardhat/types';

import {
  ERC20,
  IMasterChef,
  IMasterChefV2,
  Vault,
  VaultV2Mock,
  Pool,
  PoolV2Mock,
  IWETH,
  StableVault,
  StableVaultV2Mock,
  Pool__factory,
} from '../typechain';
import { deployContract } from 'ethereum-waffle';
import { Contracts, getMasterChefPid, getSushiRewarder, getWhale, Tokens } from './constants';

// Helper functions to deploy contracts
export async function deployVault(
  admin: SignerWithAddress,
  maxEth: BigNumber,
  feeTo: string,
  feeAmount: BigNumber,
): Promise<Vault> {
  const vaultArtifact: Artifact = await hre.artifacts.readArtifact('Vault');
  return (await deployContract(admin, vaultArtifact, [maxEth, feeTo, feeAmount])) as Vault;
}

export async function deployVaultV2(admin: SignerWithAddress): Promise<VaultV2Mock> {
  const vaultArtifact: Artifact = await hre.artifacts.readArtifact('VaultV2Mock');
  return (await deployContract(admin, vaultArtifact)) as VaultV2Mock;
}

export async function deployPool(
  admin: SignerWithAddress,
  vault: Vault,
  token: ERC20,
  fixedRate: BigNumber,
  override: boolean = false,
): Promise<Pool> {
  await vault.deployPool(
    token.address,
    getSushiRewarder(token.address),
    getMasterChefPid(token.address),
    fixedRate,
    override,
  );
  const pool = await vault.tokenToPool(token.address);
  return Pool__factory.connect(pool, admin);
}

export async function deployPoolV2(admin: SignerWithAddress, address: string): Promise<PoolV2Mock> {
  const poolArtifact: Artifact = await hre.artifacts.readArtifact('PoolV2Mock');
  return (await deployContract(admin, poolArtifact, [address])) as PoolV2Mock;
}

export async function deployStableVault(admin: SignerWithAddress): Promise<StableVault> {
  const stableVaultArtifact: Artifact = await hre.artifacts.readArtifact('StableVault');
  return (await deployContract(admin, stableVaultArtifact)) as StableVault;
}

export async function deployStableVaultV2(admin: SignerWithAddress, address: string): Promise<StableVaultV2Mock> {
  const stableVaultV2Artifact: Artifact = await hre.artifacts.readArtifact('StableVaultV2Mock');
  return (await deployContract(admin, stableVaultV2Artifact, [address])) as StableVaultV2Mock;
}

// Helper function to get existing contracts
export async function getERC20(address: string): Promise<ERC20> {
  return (await hre.ethers.getContractAt('ERC20', address)) as ERC20;
}

export async function getMasterChef(): Promise<IMasterChef> {
  return (await hre.ethers.getContractAt('IMasterChef', Contracts.masterChef)) as IMasterChef;
}

export async function getMasterChefV2(): Promise<IMasterChefV2> {
  return (await hre.ethers.getContractAt('IMasterChefV2', Contracts.masterChefV2)) as IMasterChefV2;
}

export async function getWETH(): Promise<IWETH> {
  return (await hre.ethers.getContractAt('IWETH', Tokens.weth)) as IWETH;
}

export async function getTokens(user: any, token: any, amount: BigNumber): Promise<void> {
  const whaleAddress: string = getWhale(token.address);
  await impersonateAccount(whaleAddress);
  const whale: SignerWithAddress = await hre.ethers.getSigner(whaleAddress);
  await token.connect(whale).transfer(user.address, amount);
}

// Helper function to interact with the EVM
async function impersonateAccount(address: string): Promise<void> {
  await hre.network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [address],
  });
}

export async function mineBlock(): Promise<void> {
  await hre.network.provider.request({
    method: 'evm_mine',
    params: [],
  });
}

export async function mineBlocks(n: number): Promise<void> {
  while (n > 0) {
    await mineBlock();
    n--;
  }
}
