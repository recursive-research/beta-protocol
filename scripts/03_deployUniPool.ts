import hre, { ethers } from 'hardhat';
import { Artifact } from 'hardhat/types';
import { deployContract } from 'ethereum-waffle';
import { UniPool } from '../typechain';
import { Addresses, Deployments, Tokens } from '../constants';

async function main() {
  const [deployer] = await ethers.getSigners();
  const fixedRate = 5;

  let vaultAddress;
  let wethAddress;
  let tokenAddress;

  if (hre.network.name == 'mainnet') {
    vaultAddress = Deployments.mainnet.vault;
    wethAddress = Tokens.weth;
    tokenAddress = '';
  } else if (hre.network.name == 'kovan') {
    vaultAddress = Deployments.kovan.vault;
    wethAddress = Tokens.kovan.weth;
    tokenAddress = Tokens.kovan.ftm;
  } else {
    throw new Error('Unsupported network');
  }

  ////////////////////////////////////////////////////
  ///////           Deploy Uni Pool            ///////
  ////////////////////////////////////////////////////

  console.log('Deploying contracts with the account:', deployer.address);
  console.log('Account balance:', (await deployer.getBalance()).toString());

  const uniPoolArtifact: Artifact = await hre.artifacts.readArtifact('UniPool');

  const tokenPool = (await deployContract(deployer, uniPoolArtifact, [
    vaultAddress,
    tokenAddress,
    fixedRate,
    wethAddress,
  ])) as UniPool;

  console.log('Pool address:', tokenPool.address);

  if (hre.network.name == 'mainnet') {
    const txn = await tokenPool.updateMigrator(Addresses.gnosis_beta);
    console.log(txn);
    await txn.wait(2);
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
