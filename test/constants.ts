export const Tokens = {
  sushi: '0x6B3595068778DD592e39A122f4f5a5cF09C90fE2',
  yfi: '0x0bc529c00C6401aEF6D220BE8C6Ea1667F6Ad93e',
};

export function getWhale(address: string): string {
  switch (address) {
    case Tokens.sushi:
    case Tokens.yfi: {
      return '0xF977814e90dA44bFA03b6295A0616a897441aceC';
    }
    default:
      return '';
  }
}
