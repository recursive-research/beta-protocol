import hre, { ethers } from 'hardhat';
import { Artifact } from 'hardhat/types';
import { deployContract } from 'ethereum-waffle';
import { Vault } from '../typechain';

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log('Deploying contracts with the account:', deployer.address);

  console.log('Account balance:', (await deployer.getBalance()).toString());

  const fixedRate = ethers.BigNumber.from('10');
  const maxEth = ethers.BigNumber.from('100');

  const vaultArtifact: Artifact = await hre.artifacts.readArtifact('Vault');
  const vault = (await deployContract(deployer, vaultArtifact, [fixedRate, maxEth])) as Vault;

  console.log('Vault address:', vault.address);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
