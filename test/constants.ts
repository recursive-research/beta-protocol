export const Tokens = {
  sushi: '0x6B3595068778DD592e39A122f4f5a5cF09C90fE2',
};

export function getWhale(address: string): string {
  switch (address) {
    case Tokens.sushi: {
      return '0xF977814e90dA44bFA03b6295A0616a897441aceC';
    }
    default:
      return '';
  }
}
