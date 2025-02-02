import hre, { ethers } from 'hardhat';
import { Artifact } from 'hardhat/types';
import { deployContract } from 'ethereum-waffle';
import { Vault } from '../typechain';
import { Addresses, Tokens } from '../constants';

async function main() {
  const [deployer] = await ethers.getSigners();

  let wethAddress;

  if (hre.network.name == 'mainnet') {
    wethAddress = Tokens.weth;
  } else if (hre.network.name == 'kovan') {
    wethAddress = Tokens.kovan.weth;
  } else {
    throw new Error('Unsupported network');
  }

  ////////////////////////////////////////////////////
  ///////             Deploy Vault             ///////
  ////////////////////////////////////////////////////

  console.log('Deploying contracts with the account:', deployer.address);
  console.log('Account balance:', (await deployer.getBalance()).toString());

  const vaultArtifact: Artifact = await hre.artifacts.readArtifact('Vault');
  const vault = (await deployContract(deployer, vaultArtifact, [wethAddress])) as Vault;

  console.log('Vault address:', vault.address);

  if (hre.network.name == 'mainnet') {
    const txn = await vault.transferOwnership(Addresses.gnosis_beta);
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
