import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers, network } from 'hardhat';
import { Addresses, Deployments, ethLPs, poolLPs } from '../constants';
import { getERC20, impersonateAccount } from './utils';
import { ERC20, RiftV1Withdraw, SushiPool, UniPool, Vault } from '../typechain/';
import { BigNumber } from 'ethers';
import config from '../hardhat.config';

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

async function resetFork() {
  await network.provider.request({
    method: 'hardhat_reset',
    params: [
      {
        forking: {
          jsonRpcUrl: config.networks?.hardhat?.forking?.url,
          blockNumber: config.networks?.hardhat?.forking?.blockNumber,
        },
      },
    ],
  });
}

// next Phase and fund the wallets that we need to interact
async function activate() {
  await resetFork();

  const signers: SignerWithAddress[] = await ethers.getSigners();
  const multisig = await ethers.getSigner(Addresses.gnosis_beta);
  await impersonateAccount(multisig.address);
  const [, alice] = signers;
  // fund multisigs
  await alice.sendTransaction({ to: multisig.address, value: ethers.utils.parseEther('100') });
  const vault = await ethers.getContractAt('Vault', Deployments.mainnet.vault);
  //unpair pool liquidity and fund lp holders
  for (const poolAddress of poolAddresses) {
    await vault.connect(multisig).unpairLiquidityPool(poolAddress, 0, 0);
    for (const LpHolder of poolLPs[poolAddress]) {
      await alice.sendTransaction({ to: LpHolder, value: ethers.utils.parseEther('1') });
    }
  }
  for (const ethLP of ethLPs) {
    await alice.sendTransaction({ to: ethLP, value: ethers.utils.parseEther('1') });
  }
  await vault.connect(multisig).nextPhase();
  await vault.connect(multisig).unwrapEth();
}

function calcWithdrawAmt(totalLp: BigNumber, LpBalance: BigNumber, totalToken: BigNumber) {
  return LpBalance.mul(totalToken).div(totalLp);
}

async function processPoolWithdraw(
  riftPoolContract: SushiPool | UniPool,
  lpHolderAddress: string,
  withdrawContract: RiftV1Withdraw,
  token: ERC20,
  totalToken: BigNumber,
) {
  const poolAddress = riftPoolContract.address;
  const unredeemedSupply = (await riftPoolContract.totalSupply()).sub(
    await withdrawContract.poolRedeemedSupply(poolAddress),
  );

  const lpHolder = await ethers.getSigner(lpHolderAddress);
  const lpBalance = await riftPoolContract.balanceOf(lpHolderAddress);
  await impersonateAccount(lpHolderAddress);
  await riftPoolContract.connect(lpHolder).approve(withdrawContract.address, lpBalance);
  const balanceBeforeWithdraw = await token.balanceOf(lpHolderAddress);

  // withdraw from the RiftV1Withdraw Contract
  await withdrawContract.connect(lpHolder).withdrawToken(poolAddress);
  const balanceAfterWithdraw = await token.balanceOf(lpHolderAddress);
  const withdrawnAmt = balanceAfterWithdraw.sub(balanceBeforeWithdraw);

  const supposedAmt = calcWithdrawAmt(unredeemedSupply, lpBalance, totalToken);
  return [withdrawnAmt, supposedAmt];
}

async function processVaultWithdraw(
  vault: Vault,
  LpHolder: string,
  withdrawContract: RiftV1Withdraw,
  totalEth: BigNumber,
) {
  const ethHolder = await ethers.getSigner(LpHolder);
  await impersonateAccount(LpHolder);
  const vaultUnredeemedSupply = (await vault.totalSupply()).sub(await withdrawContract.vaultRedeemedSupply());

  const vaultLpBalance = await vault.balanceOf(LpHolder);
  const balanceBeforeWithdraw = await ethers.provider.getBalance(LpHolder);
  await vault.connect(ethHolder).approve(withdrawContract.address, vaultLpBalance);
  await withdrawContract.connect(ethHolder).withdrawETH();
  const balanceAfterWithdraw = await ethers.provider.getBalance(LpHolder);
  const withdrawAmt = balanceAfterWithdraw.sub(balanceBeforeWithdraw);

  const supposedAmt = calcWithdrawAmt(vaultUnredeemedSupply, vaultLpBalance, totalEth);
  return [withdrawAmt, supposedAmt];
}

async function getPoolContractAndToken(poolAddress: string) {
  const isSushiPool = sushiPools.includes(poolAddress);
  const pool = isSushiPool
    ? await ethers.getContractAt('SushiPool', poolAddress)
    : await ethers.getContractAt('UniPool', poolAddress);
  const token = await getERC20(await pool.token());
  const contractAndToken: [SushiPool | UniPool, ERC20] = [pool, token];
  return contractAndToken;
}

describe.only('RiftV1Withdraw Unit Tests', async function () {
  let vault: Vault;
  let multisig: SignerWithAddress;
  let withdrawContract: RiftV1Withdraw;

  async function activateAndInitWithdrawContract() {
    await activate();
    vault = await ethers.getContractAt('Vault', Deployments.mainnet.vault);
    multisig = await ethers.getSigner(Addresses.gnosis_beta);
    const withdrawFactory = await ethers.getContractFactory('RiftV1Withdraw');
    withdrawContract = await withdrawFactory.deploy(multisig.address, Deployments.mainnet.vault, poolAddresses);
  }

  describe('Withdrawing', async function () {
    it('Withdraw From Each Pool and Vault Once', async function () {
      await activateAndInitWithdrawContract();

      // Process Pool
      for (const poolAddress of poolAddresses) {
        const [pool, token] = await getPoolContractAndToken(poolAddress);

        // Balance of token in the Rift Pool
        let totalToken = await token.balanceOf(poolAddress);
        await pool.connect(multisig).migrateLiquidity(withdrawContract.address);

        for (const lpHolderAddress of poolLPs[poolAddress]) {
          const [withdrawAmt, supposedAmt] = await processPoolWithdraw(
            pool,
            lpHolderAddress,
            withdrawContract,
            token,
            totalToken,
          );
          totalToken = totalToken.sub(withdrawAmt);
          expect(withdrawAmt).to.be.equal(supposedAmt);
        }
      }
      // Process Vault
      // get vault eth balances
      let totalEth = await ethers.provider.getBalance(vault.address);
      await vault.connect(multisig).migrateLiquidity(withdrawContract.address);
      // Migrate Liquidity for Vault
      for (const ethLpAddress of ethLPs) {
        const [withdrawnAmt, supposedAmt] = await processVaultWithdraw(vault, ethLpAddress, withdrawContract, totalEth);
        // supposed amt and withdrawn amt might be different due to gas
        totalEth = totalEth.sub(supposedAmt);
        // compute the difference between withdrawn amt and suppose amt, should not be greater than 0.1 ETH
        const gas = supposedAmt.sub(withdrawnAmt);
        expect(gas.lte(ethers.utils.parseEther('0.1')) && gas.gte(0));
      }
    });

    it('Withdraw Twice Expected To Fail', async () => {
      for (const poolAddress of poolAddresses) {
        const isSushiPool = sushiPools.includes(poolAddress);
        const pool = isSushiPool
          ? await ethers.getContractAt('SushiPool', poolAddress)
          : await ethers.getContractAt('UniPool', poolAddress);
        for (const lpHolderAddress of poolLPs[poolAddress]) {
          const LpHolder = await ethers.getSigner(lpHolderAddress);
          await expect(withdrawContract.connect(LpHolder).withdrawToken(pool.address)).to.be.revertedWith(
            'NO LIQUIDITY',
          );
        }
      }
      for (const ethLPAddress of ethLPs) {
        const LpHolder = await ethers.getSigner(ethLPAddress);
        await expect(withdrawContract.connect(LpHolder).withdrawETH()).to.be.revertedWith('NO LIQUIDITY');
      }
    });
  });

  describe('Rescue', async function () {
    beforeEach(activateAndInitWithdrawContract);

    it('Guardian Can Rescue Tokens', async () => {
      for (const poolAddress of poolAddresses) {
        const [pool, token] = await getPoolContractAndToken(poolAddress);

        const totalToken = await token.balanceOf(poolAddress);
        await pool.connect(multisig).migrateLiquidity(withdrawContract.address);

        await withdrawContract.connect(multisig).rescueTokens(pool.address);

        expect(await token.balanceOf(multisig.address)).to.equal(totalToken);
      }
    });

    it('Guardian Can Rescue ETH', async () => {
      const totalEth = await ethers.provider.getBalance(vault.address);
      await vault.connect(multisig).migrateLiquidity(withdrawContract.address);

      const balanceBeforeWithdraw = await ethers.provider.getBalance(multisig.address);
      await withdrawContract.connect(multisig).rescueETH();
      const balanceAfterWithdraw = await ethers.provider.getBalance(multisig.address);

      const withdrawnEth = balanceAfterWithdraw.sub(balanceBeforeWithdraw);
      const gas = totalEth.sub(withdrawnEth);

      expect(gas.lte(ethers.utils.parseEther('0.1')) && gas.gte(0));
    });

    it('Non-guardian Cannot Rescue Tokens', async () => {
      const signers: SignerWithAddress[] = await ethers.getSigners();
      const [, alice] = signers;

      for (const poolAddress of poolAddresses) {
        const [pool, token] = await getPoolContractAndToken(poolAddress);
        await pool.connect(multisig).migrateLiquidity(withdrawContract.address);

        await expect(withdrawContract.connect(alice).rescueTokens(token.address)).to.be.revertedWith('ONLY GUARDIAN');
      }
    });

    it('Non-guardian Cannot Rescue ETH', async () => {
      const signers: SignerWithAddress[] = await ethers.getSigners();
      const [, alice] = signers;
      await vault.connect(multisig).migrateLiquidity(withdrawContract.address);

      await expect(withdrawContract.connect(alice).rescueETH()).to.be.revertedWith('ONLY GUARDIAN');
    });
  });

  /*describe('Double Migration', async function() {

    // TODO: Replace with Unit Test
    beforeEach(activateAndInitWithdrawContract);

    it('Double Token Migration - Expected Behavior', async () => {
      for (const poolAddress of poolAddresses) {
        // Test for each token
      }
    });

    it('Double ETH Migration Expected Behavior  - Expected Behavior', async () => {
      // Test for ETH
    });

  });*/
});
