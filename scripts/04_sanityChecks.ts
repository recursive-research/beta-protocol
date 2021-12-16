import { ethers } from 'hardhat';
import { Addresses, Deployments } from '../constants';
import { expect } from 'chai';

const poolAddresses = [
  Deployments.mainnet.alcxPool,
  Deployments.mainnet.ftmPool,
  Deployments.mainnet.injPool,
  Deployments.mainnet.pondPool,
  Deployments.mainnet.rampPool,
  Deployments.mainnet.uftPool,
  Deployments.mainnet.prqPool,
];

async function main() {
  for (const poolAddress of poolAddresses) {
    console.log('verifying pool at:', poolAddress);
    const pool = await ethers.getContractAt('SushiPool', poolAddress);
    console.log('token: ', await pool.token());
    console.log('pair: ', await pool.pair());

    expect(await pool.vault()).to.eq(Deployments.mainnet.vault);
    expect(await pool.migrator()).to.eq(Addresses.gnosis_beta);
  }
  console.log('done!');
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
