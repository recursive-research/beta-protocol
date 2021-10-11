// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.6;

import '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '../interfaces/IPoolV2.sol';

contract PoolV2Mock is ERC20('Mock V2 Pool', 'mv2p'), IPoolV2 {
    address public token;

    constructor(address _token) {
        token = _token;
    }

    function migrateLiquidity(uint256 _amount, address _onBehalfOf) external override {
        IERC20(token).transferFrom(msg.sender, address(this), _amount);
        _mint(_onBehalfOf, _amount);
    }
}
