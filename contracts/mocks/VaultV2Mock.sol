// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.6;

import '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import '../interfaces/IVaultV2.sol';

contract VaultV2Mock is ERC20('Mock V2 Vault', 'mv2v'), IVaultV2 {
    function migrateLiquidity(address _onBehalfOf) external payable override {
        _mint(_onBehalfOf, msg.value);
    }
}
