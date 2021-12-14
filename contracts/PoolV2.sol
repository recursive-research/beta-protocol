// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.6;

import '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import './interfaces/IPoolV2.sol';

contract PoolWithdraw is IPoolV2 {
    using SafeERC20 for IERC20;

    address public token;
    address public poolV1;
    uint256 public effectiveTotalSupply;

    mapping(address => bool) public withdrawn;

    constructor(address _token, address _poolV1) {
        token = _token;
        poolV1 = _poolV1;
        effectiveTotalSupply = IERC20(_poolV1).totalSupply();
    }

    function migrateLiquidity(uint256 _amount) external override {
        require(msg.sender == poolV1, 'only poolV1');
        IERC20(token).transferFrom(msg.sender, address(this), _amount);
    }

    function withdraw() external {
        uint256 v1Balance = IERC20(poolV1).balanceOf(msg.sender);
        require(v1Balance > 0, 'no v1 balance');
        require(!withdrawn[msg.sender], 'user already withdrawn');

        uint256 tokenShare = (IERC20(token).balanceOf(address(this)) * v1Balance) / effectiveTotalSupply - 1;
        effectiveTotalSupply -= v1Balance;

        withdrawn[msg.sender] = true;
        IERC20(token).transfer(msg.sender, tokenShare);
    }
}
