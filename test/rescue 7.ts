import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { BigNumber } from 'ethers';
import { ethers } from 'hardhat';
import { Addresses, Deployments } from '../constants';
import { getERC20, impersonateAccount } from './utils';
import { RiftV1Withdraw, Vault, ERC20 } from '../typechain/';

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

async function activate() {
  const signers: SignerWithAddress[] = await ethers.getSigners();
  const multisig = await ethers.getSigner(Addresses.gnosis_beta);
  await impersonateAccount(multisig.address);
  const [, alice] = signers;
  // fund multisigs
  await alice.sendTransaction({ to: multisig.address, value: ethers.utils.parseEther('100') });
  const vault = await ethers.getContractAt('Vault', Deployments.mainnet.vault);
  //unpair pool liquidity and fund lp holders
  for (let i = 0; i < poolAddresses.length; i++) {
    const poolAddress = poolAddresses[i];
    await vault.connect(multisig).unpairLiquidityPool(poolAddress, 0, 0);
  }
  await vault.connect(multisig).nextPhase();
  await vault.connect(multisig).unwrapEth();
}

describe('Rescue Tokens', async () => {
  it('Rescue All Tokens and Ether', async () => {
    await activate();
    const vault: Vault = await ethers.getContractAt('Vault', Deployments.mainnet.vault);
    const multisig = await ethers.getSigner(Addresses.gnosis_beta);
    const withdrawn = await ethers.getContractFactory('RiftV1Withdraw');
    const withdrawnContract: RiftV1Withdraw = await withdrawn.deploy(
      Deployments.mainnet.vault,
      poolAddresses,
      Addresses.gnosis_beta,
    );
    const supAmt: BigNumber[] = [];
    const tokenContracts: ERC20[] = [];
    const tokenAddresses: string[] = [];
    const tokenAmt: BigNumber[] = [];
    const prevTokenBalances: BigNumber[] = [];
    for (let i = 0; i < poolAddresses.length; i++) {
      // Migrate Liquidity for Pool
      const poolAddress = poolAddresses[i];
      const isSushiPool = sushiPools.includes(poolAddress);
      const pool = isSushiPool
        ? await ethers.getContractAt('SushiPool', poolAddress)
        : await ethers.getContractAt('UniPool', poolAddress);
      const token = await getERC20(await pool.token());
      prevTokenBalances.push(await token.balanceOf(multisig.address));
      // Balance of token in the Rift Pool
      const totalToken = await token.balanceOf(poolAddress);
      supAmt.push(totalToken);
      tokenContracts.push(token);
      // set up parameters for rescueToken()
      tokenAddresses.push(token.address);
      tokenAmt.push(BigNumber.from('0'));
      await pool.connect(multisig).migrateLiquidity(withdrawnContract.address);
    }
    tokenAddresses.push(Addresses.zero);
    tokenAmt.push(BigNumber.from('0'));
    const totalEth = await ethers.provider.getBalance(vault.address);
    const prevEth = await ethers.provider.getBalance(multisig.address);
    await vault.connect(multisig).migrateLiquidity(withdrawnContract.address);
    await withdrawnContract.connect(multisig).rescueTokens(tokenAddresses, tokenAmt);
    // make sure all the tokens are withdrawn to the multisig wallet
    for (let i = 0; i < tokenContracts.length; i++) {
      const curTokenBalance = await tokenContracts[i].balanceOf(multisig.address);
      const rescueAmt = curTokenBalance.sub(prevTokenBalances[i]);
      expect(rescueAmt).to.be.equal(supAmt[i]);
    }
    // make sure Ether is also correctly withdrawn
    const curEth = await ethers.provider.getBalance(multisig.address);
    const rescueEth = curEth.sub(prevEth);
    const gas = totalEth.sub(rescueEth);
    expect(gas.lte(ethers.utils.parseEther('0.1')));
  });
});
