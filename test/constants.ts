import { BigNumber } from 'ethers';

export const Tokens = {
  alcx: '0xdBdb4d16EdA451D0503b854CF79D55697F90c8DF',
  aave: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9',
  sushi: '0x6B3595068778DD592e39A122f4f5a5cF09C90fE2',
  yfi: '0x0bc529c00C6401aEF6D220BE8C6Ea1667F6Ad93e',
  weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
};

export const Contracts = {
  masterChef: '0xc2EdaD668740f1aA35E4D8f227fB8E17dcA888Cd',
  masterChefV2: '0xEF0881eC094552b2e128Cf945EF17a6752B4Ec5d',
};

export function getWhale(address: string): string {
  switch (address) {
    case Tokens.aave:
    case Tokens.sushi:
    case Tokens.yfi: {
      return '0xF977814e90dA44bFA03b6295A0616a897441aceC';
    }
    case Tokens.alcx:
      return '0x000000000000000000000000000000000000dEaD';
    default:
      return '';
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
      return BigNumber.from('9999');
  }
}

export function isMasterChefV2(address: string): boolean {
  switch (address) {
    case Tokens.yfi:
    case Tokens.aave:
      return false;
    case Tokens.alcx:
      return true;
    default:
      return false;
  }
}
