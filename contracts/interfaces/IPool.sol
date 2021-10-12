// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.6;

interface IPool {
    function pairLiquidity(
        uint256 amount,
        uint256 _minAmountToken,
        uint256 _minAmountWETH
    ) external;

    function unpairLiquidity(uint256 _minAmountToken, uint256 _minAmountWETH) external;
}
