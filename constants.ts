import { BigNumber } from 'ethers';

export const Tokens = {
  alcx: '0xdBdb4d16EdA451D0503b854CF79D55697F90c8DF',
  aave: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9',
  ftm: '0x4E15361FD6b4BB609Fa63C81A2be19d873717870',
  inj: '0xe28b3B32B6c345A34Ff64674606124Dd5Aceca30',
  pond: '0x57b946008913b82e4df85f501cbaed910e58d26c',
  prq: '0x362bc847A3a9637d3af6624EeC853618a43ed7D2',
  ramp: '0x33d0568941c0c64ff7e0fb4fba0b11bd37deed9f',
  sushi: '0x6B3595068778DD592e39A122f4f5a5cF09C90fE2',
  uft: '0x0202be363b8a4820f3f4de7faf5224ff05943ab1',
  usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  usdt: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  yfi: '0x0bc529c00C6401aEF6D220BE8C6Ea1667F6Ad93e',
  weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  wluna: '0xd2877702675e6cEb975b4A1dFf9fb7BAF4C91ea9',
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
    pondPool: '0xefD125D4D79A4f2EBD2AF72e3Da36DC49f6cA06D',
    rampPool: '0xbe14D2dEeBD03965db36f6d43509a7F1Ff5baf94',
    prqPool: '0x0d97dcA377213b170E3448C25b4FA522444006C7',
    uftPool: '0xA6aD33dD3ffdD8194bC8B870702e2dEFe3ed3183',
    wlunaPool: '0x6a059A78ac1Da620CBbF25e0Fb542555117795AA',
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

export const poolLP = [
  '0x447f95026107aaed7472a0470931e689f51e0e42',
  '0xad828338e133a982c329e5eced8eefb09e4e4d28',
  '0xd5d38af4482a37e3e0e6c86cb4d1cd97a04161b9',
  '0xc9014686f6336ad558b539565d5dff840b339082',
  '0xd8515ae9d3b9cdecbeeb3f21f6ea4ee170199f1d',
  '0xdcc6855b771dbde9d8b50896d198d9e062b6cb8a',
  '0x423e9f2ab855e61f7f07d2586cd9484ae4416d44',
  '0xef34f1f686297ef83d9fc0c06b0c68c9d16b07b9',
];

export const ethLP = [
  '0x8163d9be044c27b5f8efb7041a5e5ad2ef53f6af',
  '0x13b841dbf99456fb55ac0a7269d9cfbc0ced7b42',
  '0x63faf3677b9728e58ffa8787ce5a41d8f05d67de',
  '0xa81ace214b97d4b9c2072a934d0c4de486757538',
  '0x5c5a37e4ee62af10e42e9a961d58796715422a90',
  '0xef91b2bfda210664732b625155b817009b6be330',
  '0xcfc37f12927291641525847ba152d40df295a7e7',
  '0x23925074619f5ee37efededa407d3dff09172a9d',
  '0xa1be3e603acc2fd5d25fab20268f674b45f30bbe',
  '0xe2d67da4fbd76401ea1f34a8255f65b6fbf5f21f',
];
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
    case Tokens.wluna:
      return '0x5f65f7b609678448494De4C87521CdF6cEf1e932';
    case Tokens.prq:
      return '0x533e3c0e6b48010873B947bddC4721b1bDFF9648';
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
