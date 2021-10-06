// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.6;

interface IVault {
    enum Phases {
        Zero,
        One,
        Two
    }

    function phase() external returns (Phases);
}
