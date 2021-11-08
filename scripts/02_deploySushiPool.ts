import hre, { ethers } from 'hardhat';
import { Artifact } from 'hardhat/types';
import { deployContract } from 'ethereum-waffle';
import { SushiPool } from '../typechain';
import { Addresses, Deployments, getMasterChefPid, getSushiRewarder, Tokens } from '../constants';

async function main() {
  const [deployer] = await ethers.getSigners();
  const token = '';

  const sushiRewarder = getSushiRewarder(token);
  const pid = getMasterChefPid(token);
  const fixedRate = 10;

  let vaultAddress;
  let wethAddress;
  let tokenAddress;

  if (hre.network.name == 'mainnet') {
    vaultAddress = Deployments.mainnet.vault;
    wethAddress = Tokens.weth;
    tokenAddress = token;
  } else if (hre.network.name == 'kovan') {
    vaultAddress = Deployments.kovan.vault;
    wethAddress = Tokens.kovan.weth;
    tokenAddress = Tokens.kovan.inj;
  } else {
    throw new Error('Unsupported network');
  }

  ////////////////////////////////////////////////////
  ///////          Deploy Sushi Pool           ///////
  ////////////////////////////////////////////////////

  console.log('Deploying contracts with the account:', deployer.address);
  console.log('Account balance:', (await deployer.getBalance()).toString());

  const sushiPoolArtifact: Artifact = await hre.artifacts.readArtifact('SushiPool');

  const tokenPool = (await deployContract(deployer, sushiPoolArtifact, [
    vaultAddress,
    tokenAddress,
    sushiRewarder,
    pid,
    fixedRate,
    wethAddress,
  ])) as SushiPool;

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
