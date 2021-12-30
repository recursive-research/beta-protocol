import { ethers } from 'hardhat';
import { Deployments } from '../constants';
const vaultAddress = Deployments.mainnet.vault;
const poolAddresses = [
  Deployments.mainnet.wlunaPool,
  Deployments.mainnet.alcxPool,
  Deployments.mainnet.ftmPool,
  Deployments.mainnet.injPool,
  Deployments.mainnet.pondPool,
  Deployments.mainnet.rampPool,
  Deployments.mainnet.uftPool,
  Deployments.mainnet.prqPool,
];

async function main() {
  const withdrawn = await ethers.getContractFactory('Withdrawn');
  const withdrawnContract = await withdrawn.deploy(vaultAddress, poolAddresses);
  console.log(await withdrawnContract.vault());
  console.log('done!');
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
