import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ethers } from 'hardhat';
import { Addresses, Deployments } from '../../constants';
import { getERC20, impersonateAccount } from '../../test/utils';

const uniPools = [
  Deployments.mainnet.wlunaPool,
  Deployments.mainnet.prqPool,
  Deployments.mainnet.uftPool,
  Deployments.mainnet.rampPool,
];

const sushiPools = [
  Deployments.mainnet.alcxPool,
  Deployments.mainnet.ftmPool,
  Deployments.mainnet.injPool,
  Deployments.mainnet.pondPool,
];

const poolAddresses = uniPools.concat(sushiPools);

async function main() {
  // get addresses
  const signers: SignerWithAddress[] = await ethers.getSigners();
  const multisig = await ethers.getSigner(Addresses.gnosis_beta);
  await impersonateAccount(multisig.address);
  const [, alice] = signers;
  await alice.sendTransaction({ to: multisig.address, value: ethers.utils.parseEther('100') }); // fund multisig

  ////////////////////////////////////////////////////
  ///////             Vault & Pools            ///////
  ////////////////////////////////////////////////////

  const vault = await ethers.getContractAt('Vault', Deployments.mainnet.vault);

  for (let i = 0; i < poolAddresses.length; i++) {
    const poolAddress = poolAddresses[i];
    const isSushiPool = sushiPools.includes(poolAddress);
    const pool = isSushiPool
      ? await ethers.getContractAt('SushiPool', poolAddress)
      : await ethers.getContractAt('UniPool', poolAddress);

    const tokenAddress = await pool.token();
    const token = await getERC20(tokenAddress);

    console.log(await token.symbol(), 'pool owns ', (await pool.lpTokenBalance()).toString(), 'LP Tokens');
  }

  for (let i = 0; i < poolAddresses.length; i++) {
    const poolAddress = poolAddresses[i];
    const isSushiPool = sushiPools.includes(poolAddress);
    const pool = isSushiPool
      ? await ethers.getContractAt('SushiPool', poolAddress)
      : await ethers.getContractAt('UniPool', poolAddress);
    const tokenAddress = await pool.token();
    const token = await getERC20(tokenAddress);

    await vault.connect(multisig).unpairLiquidityPool(poolAddress, 0, 0);

    const tokenBalanceFinal = await token.balanceOf(pool.address);
    const initialDeposits = await pool.totalSupply();

    console.log(await token.symbol(), 'pool unpaired');
    console.log('-- initial deposits:', ethers.utils.formatUnits(initialDeposits, 18));
    console.log('-- final balance:', ethers.utils.formatUnits(tokenBalanceFinal, 18));
  }

  await vault.connect(multisig).nextPhase();
  await vault.connect(multisig).unwrapEth();
  const ethBalanceFinal = await ethers.provider.getBalance(vault.address);

  console.log(
    'ETH Returns:',
    ethers.utils.formatUnits(ethBalanceFinal, 18),
    'on initial deposits of',
    ethers.utils.formatUnits(await vault.totalSupply(), 18),
  );
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
