// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.6;

interface IVault {
    enum Phases {
        Zero,
        One,
        Two
    }

    function fixedRate() external view returns (uint256);

    function phase() external view returns (Phases);

    function depositTimestamp() external view returns (uint256);
}
