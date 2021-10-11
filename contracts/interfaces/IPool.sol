// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.6;

interface IPool {
    function pairLiquidity(uint256 amount) external;

    function unpairLiquidity() external;
}
