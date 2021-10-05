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

let alchemyApiUrlMumbai: string;
if (!process.env.ALCHEMY_API_URL_MUMBAI) {
  throw new Error('Please set your ALCHEMY_API_URL_MUMBAI in a .env file');
} else {
  alchemyApiUrlMumbai = process.env.ALCHEMY_API_URL_MUMBAI;
}

let alchemyApiUrlMainnet: string;
if (!process.env.ALCHEMY_API_URL_MAINNET) {
  throw new Error('Please set your ALCHEMY_API_URL_MAINNET in a .env file');
} else {
  alchemyApiUrlMainnet = process.env.ALCHEMY_API_URL_MAINNET;
}

const config: HardhatUserConfig = {
  defaultNetwork: 'hardhat',
  gasReporter: {
    currency: 'USD',
    enabled: process.env.REPORT_GAS ? true : false,
    src: './contracts',
  },
  abiExporter: {
    path: 'abis/',
    clear: true,
    flat: true,
    spacing: 2,
  },
  networks: {
    hardhat: {
      chainId: 31337,
      forking: {
        url: alchemyApiUrlMainnet,
        blockNumber: 13000000, // post-london
      },
    },
    mumbai: {
      chainId: 80001,
      accounts: [privateKey],
      url: alchemyApiUrlMumbai,
    },
  },
  paths: {
    artifacts: './artifacts',
    cache: './cache',
    sources: './contracts',
    tests: './test',
  },
  solidity: {
    version: '0.8.6',
  },
  typechain: {
    outDir: 'typechain',
    target: 'ethers-v5',
  },
};

export default config;
