// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.6;

interface IStableVaultV2 {
    function migrateLiquidity(uint256 _amount, address _onBehalfOf) external;
}
