// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.6;

import '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import '../interfaces/IVaultV2.sol';

contract VaultV2Mock is ERC20('Mock V2 Vault', 'mv2v'), IVaultV2 {
    address public vaultV1;

    constructor(address _vaultV1) {
        vaultV1 = _vaultV1;
    }

    function migrateLiquidity() external payable override {
        require(msg.sender == vaultV1, 'only vault v1');
        _mint(msg.sender, msg.value);
    }
}
