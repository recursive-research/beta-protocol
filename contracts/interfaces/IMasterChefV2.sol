// SPDX-License-Identifier: MIT

pragma solidity 0.8.6;

interface IMasterChefV2 {
    struct UserInfo {
        uint256 amount;
        int256 rewardDebt;
    }

    struct PoolInfo {
        uint128 accSushiPerShare;
        uint64 lastRewardBlock;
        uint64 allocPoint;
    }

    function userInfo(uint256 pid, address addr) external view returns (UserInfo memory);

    function deposit(
        uint256 pid,
        uint256 amount,
        address to
    ) external;

    function withdrawAndHarvest(
        uint256 pid,
        uint256 amount,
        address to
    ) external;
}
