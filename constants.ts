import { BigNumber } from 'ethers';

export const Tokens = {
  alcx: '0xdBdb4d16EdA451D0503b854CF79D55697F90c8DF',
  aave: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9',
  ftm: '0x4E15361FD6b4BB609Fa63C81A2be19d873717870',
  inj: '0xe28b3B32B6c345A34Ff64674606124Dd5Aceca30',
  sushi: '0x6B3595068778DD592e39A122f4f5a5cF09C90fE2',
  usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  usdt: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  yfi: '0x0bc529c00C6401aEF6D220BE8C6Ea1667F6Ad93e',
  weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  kovan: {
    usdc: '0xe22da380ee6B445bb8273C81944ADEB6E8450422',
    usdt: '0x13512979ADE267AB5100878E2e0f485B568328a4',
    weth: '0xd0A1E359811322d97991E03f863a0C30C2cF029C',
    inj: '0xC1EFDc173A6453EBa26076591797596045BA10d0',
    ftm: '0x5ef63F2f3c69F8B0C519a218D99642d13bD7A81c',
  },
};

export const Deployments = {
  kovan: {
    vault: '0x08e4b95Efdbbc50CA16924F032841444Db954a30',
    injPool: '0x5DDe72263bA9E84c0b2e298c795F9b8939FCB48f',
    ftmPool: '0x1fCA8c2CE7C4FA9046b183F699AF7a5977C4FD9D',
    stableVault: '0x820EFff6D9A3017e65025f2010bBED60904052fD',
    stableVaultUSDC: '0x2ded02155B7246231A1530e37Ca8CC725fC41D29',
    stableVaultUSDT: '0xc00312f64691C25dDA5ACC002e58d379b0eABb51',
  },
  mainnet: {
    vault: '0x55ca010c9E69b1D0D1919F3b7208Fa5DF63E2295',
    alcxPool: '0x6Ef46C66FdeF4Cd6Bd827a39007eD9AD1Dc56FA6',
    ftmPool: '0x818022D2c4B9A4e5Dd224Fd7517901AB7A1405EE',
    injPool: '0x8d600822A660fa32bf574d2e3B837B21faE65e1d',
    stableVault: '0x9d6C589c2Fb109a57b4676e5438E5798A2f2bB5E',
    stableVaultUSDC: '0x7395537e0AaAC7EcA1E6491eCC7F5d09F5742370',
    stableVaultUSDT: '0x2432b2b951D2c8E436F79C0B453Ad7f28c81CD72',
  },
};

export const Contracts = {
  masterChef: '0xc2EdaD668740f1aA35E4D8f227fB8E17dcA888Cd',
  masterChefV2: '0xEF0881eC094552b2e128Cf945EF17a6752B4Ec5d',
  sushiRouter: '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F',
  uniswapRouter: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
};

export const Addresses = {
  zero: '0x0000000000000000000000000000000000000000',
  dead: '0x000000000000000000000000000000000000dEaD',
  gnosis_beta: '0x597C38aE5e20f81DcE85E484621e05b1ED99B235',
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
    case Tokens.inj:
      return '0x47ac0Fb4F2D84898e4D9E7b4DaB3C24507a6D503';
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
    case Tokens.ftm:
      return BigNumber.from('140');
    case Tokens.inj:
      return BigNumber.from('69');
    default:
      return BigNumber.from('0');
  }
}

export function getSushiRewarder(address: string): BigNumber {
  switch (address) {
    case Tokens.yfi:
    case Tokens.inj:
    case Tokens.sushi:
    case Tokens.ftm:
      return BigNumber.from(1); // Master Chef
    case Tokens.alcx:
      return BigNumber.from(2); // Master Chef V2
    default:
      return BigNumber.from(0); // None
  }
}
