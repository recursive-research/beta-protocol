import '@nomiclabs/hardhat-waffle';
import '@typechain/hardhat';
import 'hardhat-gas-reporter';
import 'solidity-coverage';
import 'hardhat-abi-exporter';

import { resolve } from 'path';

import { config as dotenvConfig } from 'dotenv';
import { HardhatUserConfig } from 'hardhat/config';

dotenvConfig({ path: resolve(__dirname, '.env') });

let privateKey: string;
if (!process.env.PRIVATE_KEY) {
  throw new Error('Please set your PRIVATE_KEY in a .env file');
} else {
  privateKey = process.env.PRIVATE_KEY;
}

let alchemyApiUrlKovan: string;
if (!process.env.ALCHEMY_API_URL_KOVAN) {
  throw new Error('Please set your ALCHEMY_API_URL_MUMBAI in a .env file');
} else {
  alchemyApiUrlKovan = process.env.ALCHEMY_API_URL_KOVAN;
}

let alchemyApiUrlMainnet: string;
if (!process.env.ALCHEMY_API_URL_MAINNET) {
  throw new Error('Please set your ALCHEMY_API_URL_MAINNET in a .env file');
} else {
  alchemyApiUrlMainnet = process.env.ALCHEMY_API_URL_MAINNET;
}

const config: HardhatUserConfig = {
  defaultNetwork: 'hardhat',
  networks: {
    hardhat: {
      chainId: 31337,
      forking: {
        url: alchemyApiUrlMainnet,
        blockNumber: 13000000, // post-london
      },
    },
    kovan: {
      chainId: 42,
      accounts: [privateKey],
      url: alchemyApiUrlKovan,
    },
  },
  solidity: {
    version: '0.8.6',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  paths: {
    artifacts: './artifacts',
    cache: './cache',
    sources: './contracts',
    tests: './test',
  },
  gasReporter: {
    currency: 'USD',
    enabled: process.env.REPORT_GAS ? true : false,
    excludeContracts: [],
    src: './contracts',
  },
  abiExporter: {
    path: 'abis/',
    clear: true,
    flat: true,
    spacing: 2,
  },
  typechain: {
    outDir: 'typechain',
    target: 'ethers-v5',
  },
};

export default config;
