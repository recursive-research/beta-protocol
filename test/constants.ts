import { BigNumber } from 'ethers';

export const Tokens = {
  alcx: '0xdBdb4d16EdA451D0503b854CF79D55697F90c8DF',
  aave: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9',
  sushi: '0x6B3595068778DD592e39A122f4f5a5cF09C90fE2',
  usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  usdt: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  yfi: '0x0bc529c00C6401aEF6D220BE8C6Ea1667F6Ad93e',
  weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
};

export const Contracts = {
  masterChef: '0xc2EdaD668740f1aA35E4D8f227fB8E17dcA888Cd',
  masterChefV2: '0xEF0881eC094552b2e128Cf945EF17a6752B4Ec5d',
  sushiRouter: '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F',
};

export const Addresses = {
  zero: '0x0000000000000000000000000000000000000000',
  dead: '0x000000000000000000000000000000000000dEaD',
};

export function getWhale(address: string): string {
  switch (address) {
    case Tokens.aave:
    case Tokens.sushi:
    case Tokens.yfi:
      return '0xF977814e90dA44bFA03b6295A0616a897441aceC';
    case Tokens.usdc:
    case Tokens.usdt:
      return '0x28c6c06298d514db089934071355e5743bf21d60';
    case Tokens.alcx:
      return '0x000000000000000000000000000000000000dEaD';
    default:
      return '0xF977814e90dA44bFA03b6295A0616a897441aceC';
  }
}

// For V1 or V2
export function getMasterChefPid(address: string): BigNumber {
  switch (address) {
    case Tokens.sushi:
      return BigNumber.from('12');
    case Tokens.yfi:
      return BigNumber.from('11');
    case Tokens.aave:
      return BigNumber.from('37');
    case Tokens.alcx:
      return BigNumber.from('0');
    default:
      return BigNumber.from('0');
  }
}

export function getSushiRewarder(address: string): BigNumber {
  switch (address) {
    case Tokens.yfi:
      return BigNumber.from(1); // Master Chef
    case Tokens.alcx:
      return BigNumber.from(2); // Master Chef V2
    default:
      return BigNumber.from(0); // None
  }
}
