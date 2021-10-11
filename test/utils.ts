import hre from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumber } from 'ethers';
import { Artifact } from 'hardhat/types';

import { ERC20, IMasterChef, IMasterChefV2, Vault, Pool, IWETH } from '../typechain';
import { deployContract } from 'ethereum-waffle';
import { Contracts, getMasterChefPid, isMasterChefV2, getWhale, Tokens } from './constants';

// Helper functions to deploy contracts
export async function deployVault(admin: SignerWithAddress, fixedRate: BigNumber, maxEth: BigNumber): Promise<Vault> {
  const vaultArtifact: Artifact = await hre.artifacts.readArtifact('Vault');
  return (await deployContract(admin, vaultArtifact, [fixedRate, maxEth])) as Vault;
}

export async function deployPool(admin: SignerWithAddress, vault: Vault, token: ERC20): Promise<Pool> {
  const poolArtifact: Artifact = await hre.artifacts.readArtifact('Pool');
  return (await deployContract(admin, poolArtifact, [
    vault.address,
    token.address,
    getMasterChefPid(token.address),
    isMasterChefV2(token.address),
  ])) as Pool;
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

export async function getTokens(user: SignerWithAddress, token: ERC20, amount: BigNumber): Promise<void> {
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
