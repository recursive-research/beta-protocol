// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.6;

interface IVaultV2 {
    function migrateLiquidity(address _onBehalfOf) external payable;
}
