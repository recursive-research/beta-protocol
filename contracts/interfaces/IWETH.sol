// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.6;

interface IWETH {
    function deposit() external payable;

    function withdraw(uint256) external;
}
