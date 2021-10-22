// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.6;

interface IPool {
    function pairLiquidity(
        uint256 _amountWeth,
        uint256 _amountToken,
        uint256 _minAmountToken,
        uint256 _minAmountWETH
    ) external returns (uint256);

    function unpairLiquidity(uint256 _minAmountToken, uint256 _minAmountWETH) external;
}
