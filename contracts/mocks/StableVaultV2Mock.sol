// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.6;

import '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import '../interfaces/IStableVaultV2.sol';

contract StableVaultV2Mock is ERC20('Mock V2 Stable Vault', 'mv2sb'), IStableVaultV2 {
    using SafeERC20 for IERC20;
    address public token;

    constructor(address _token) {
        token = _token;
    }

    function migrateLiquidity(uint256 _amount, address _onBehalfOf) external override {
        IERC20(token).safeTransferFrom(msg.sender, address(this), _amount);
        _mint(_onBehalfOf, _amount);
    }
}
