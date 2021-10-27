// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.6;

import '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '../interfaces/IPoolV2.sol';

contract PoolV2Mock is ERC20('Mock V2 Pool', 'mv2p'), IPoolV2 {
    address public token;
    address public poolV1;

    constructor(address _token, address _poolV1) {
        token = _token;
        poolV1 = _poolV1;
    }

    function migrateLiquidity(uint256 _amount) external override {
        require(msg.sender == poolV1, 'only poolV1');
        _mint(poolV1, _amount);
        IERC20(token).transferFrom(msg.sender, address(this), _amount);
    }

    function redeem(uint256 _amount) external {
        uint256 poolV1Unredeemed = IERC20(poolV1).totalSupply() - IERC20(poolV1).balanceOf(address(this));
        uint256 userPoolV1Balance = IERC20(poolV1).balanceOf(msg.sender);
        require(userPoolV1Balance >= _amount, 'Insufficient Funds');

        uint256 poolV1RemainingAllocation = balanceOf(poolV1);
        uint256 userShare = (poolV1RemainingAllocation * userPoolV1Balance) / poolV1Unredeemed;

        _burn(poolV1, userShare);
        _mint(msg.sender, userShare);

        IERC20(poolV1).transferFrom(msg.sender, address(this), _amount);
    }
}
