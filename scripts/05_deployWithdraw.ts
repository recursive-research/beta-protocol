import hre, { ethers } from 'hardhat';
import { Deployments } from '../constants';

// const mainnetPoolAddresses = [
//   Deployments.mainnet.alcxPool,
//   Deployments.mainnet.ftmPool,
//   Deployments.mainnet.injPool,
//   Deployments.mainnet.pondPool,
//   Deployments.mainnet.rampPool,
//   Deployments.mainnet.uftPool,
//   Deployments.mainnet.prqPool,
//   Deployments.mainnet.wlunaPool,
// ];

const kovanPoolAddresses = [Deployments.kovan.ftmPool, Deployments.kovan.injPool];

async function main() {
  const [deployer] = await ethers.getSigners();
  const withdrawFactory = await ethers.getContractFactory('RiftV1Withdraw');

  if (hre.network.name == 'mainnet') {
    // Only activate this when we're deploying to mainnet
    // const vaultAddress = Deployments.mainnet.vault;
    // const withdrawContract = await withdrawFactory.deploy(Addresses.gnosis_beta, vaultAddress, mainnetPoolAddresses);
    // console.log('Deployed to: ', withdrawContract.address);
  } else if (hre.network.name == 'kovan') {
    const vaultAddress = Deployments.kovan.vault;
    const withdrawContract = await withdrawFactory.deploy(deployer.address, vaultAddress, kovanPoolAddresses);
    console.log('Deployed to: ', withdrawContract.address);
  }

  console.log('done!');
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
