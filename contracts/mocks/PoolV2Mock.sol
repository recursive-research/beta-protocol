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

    // how the v2 contracts will enable redeeming the old staking token for the new one
    function redeem(uint256 _amount) external {
        // pool v1 staking tokens that haven't been redeemed for pool V2 staking tokens yet
        // because after a user redeems, their pool v1 staking tokens are transferred to this contract
        uint256 poolV1Unredeemed = IERC20(poolV1).totalSupply() - IERC20(poolV1).balanceOf(address(this));
        // user's pool v1 staking tokens
        uint256 userPoolV1Balance = IERC20(poolV1).balanceOf(msg.sender);
        require(userPoolV1Balance >= _amount, 'Insufficient Funds');

        // the remaining pool v2 staking tokens that are able to be claimed by v1 users
        uint256 poolV1RemainingAllocation = balanceOf(poolV1);
        // the user's share of the remaining pool v2 staking tokens (based on amount param)
        uint256 userShare = (poolV1RemainingAllocation * _amount) / poolV1Unredeemed;

        // burn the user's share of pool v2 staking tokens from pool v1
        _burn(poolV1, userShare);
        // mint the user's share of pool v2 staking tokens to the user
        _mint(msg.sender, userShare);

        // transfer the user's pool v1 staking tokens to this contract
        IERC20(poolV1).transferFrom(msg.sender, address(this), _amount);
    }
}
