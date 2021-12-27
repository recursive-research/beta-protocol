import { ethers } from 'hardhat';
import { Addresses, Deployments } from '../constants';
const vaultAddress = Deployments.mainnet.vault;
const poolAddresses = [
  Deployments.mainnet.alcxPool,
  Deployments.mainnet.ftmPool,
  Deployments.mainnet.injPool,
  Deployments.mainnet.pondPool,
  Deployments.mainnet.rampPool,
  Deployments.mainnet.uftPool,
  Deployments.mainnet.prqPool,
  Deployments.mainnet.wlunaPool,
];

async function main() {
  const withdrawFactory = await ethers.getContractFactory('RiftV1Withdraw');
  const multisig = await ethers.getSigner(Addresses.gnosis_beta);
  const withdrawContract = await withdrawFactory.deploy(multisig.address, vaultAddress, poolAddresses);
  console.log(await withdrawContract.vault());
  console.log('done!');
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
