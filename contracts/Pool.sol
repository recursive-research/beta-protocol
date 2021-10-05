// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.6;

contract Pool {
    address public vault;
    uint256 public token;

    constructor(address _vault, uint256 _token) {
        vault = _vault;
        token = _token;
    }
}
