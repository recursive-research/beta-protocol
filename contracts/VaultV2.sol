// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.6;

import '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '../interfaces/IVaultV2.sol';

contract VaultV2Mock is IVaultV2 {
    using SafeERC20 for IERC20;

    address public vaultV1;
    uint256 public effectiveTotalSupply;

    constructor(address _vaultV1) {
        vaultV1 = _vaultV1;
        effectiveTotalSupply = IERC20(_vaultV1).totalSupply();
    }

    function migrateLiquidity() external payable override {
        require(msg.sender == vaultV1, 'only vault v1');
    }

    function withdraw() external {
        uint256 v1Balance = IERC20(vaultV1).balanceOf(msg.sender);
        require(v1Balance > 0, 'no v1 balance');

        uint256 ethShare = (address(this).balance * v1Balance) / effectiveTotalSupply - 1;
        effectiveTotalSupply -= v1Balance;

        IERC20(vaultV1).transferFrom(msg.sender, address(this), v1Balance);
        payable(msg.sender).transfer(ethShare);
    }
}
