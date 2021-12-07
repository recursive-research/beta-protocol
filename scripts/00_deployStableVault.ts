import hre, { ethers } from 'hardhat';
import { Artifact } from 'hardhat/types';
import { deployContract } from 'ethereum-waffle';
import { StableVault } from '../typechain';
import { Addresses, Tokens } from '../constants';

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log('Deploying contracts with the account:', deployer.address);

  console.log('Account balance:', (await deployer.getBalance()).toString());

  let usdc;
  let usdt;

  if (hre.network.name == 'mainnet') {
    usdc = Tokens.usdc;
    usdt = Tokens.usdt;
  } else if (hre.network.name == 'kovan') {
    usdc = Tokens.kovan.usdc;
    usdt = Tokens.kovan.usdt;
  } else {
    throw new Error('Unsupported network');
  }

  ////////////////////////////////////////////////////
  ///////          Deploy Stable Vault         ///////
  ////////////////////////////////////////////////////

  const StableVaultArtifact: Artifact = await hre.artifacts.readArtifact('StableVault');
  const stableVault = (await deployContract(deployer, StableVaultArtifact, [usdc, usdt])) as StableVault;

  console.log('StableVault address:', stableVault.address);
  console.log('StableVaultUSDC address: ', await stableVault.svUsdc());
  console.log('StableVaultUSDT address: ', await stableVault.svUsdt());

  if (hre.network.name == 'mainnet') {
    const txn = await stableVault.transferOwnership(Addresses.gnosis_beta);
    console.log('Transfer Ownership txn:', txn);
    await txn.wait(2);
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
