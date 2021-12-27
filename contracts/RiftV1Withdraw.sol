// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.6;
import '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import './interfaces/IPool.sol';

contract RiftV1Withdraw {
    using SafeERC20 for IERC20;

    address public immutable guardian;

    address public immutable vault;
    uint256 public vaultRedeemedSupply;

    mapping(address => address) public poolToToken;
    mapping(address => uint256) public poolRedeemedSupply;

    constructor(
        address _guardian,
        address _vault,
        address[] memory pools
    ) {
        guardian = _guardian;
        vault = _vault;
        for (uint256 i = 0; i < pools.length; i++) {
            poolToToken[pools[i]] = IPool(pools[i]).token();
        }
    }

    function migrateLiquidity(uint256 amount) external {
        address token = poolToToken[msg.sender];
        require(token != address(0), 'ONLY POOL');
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
    }

    function migrateLiquidity() external payable {
        require(msg.sender == vault, 'ONLY VAULT');
    }

    function withdrawToken(address pool) external {
        address token = poolToToken[pool];
        require(token != address(0), 'ONLY POOL');

        uint256 lpBalance = IERC20(pool).balanceOf(msg.sender);
        require(lpBalance != 0, 'NO LIQUIDITY');
        IERC20(pool).safeTransferFrom(msg.sender, address(this), lpBalance);

        uint256 tokenBalance = IERC20(token).balanceOf(address(this));
        uint256 unredeemedSupply = IERC20(pool).totalSupply() - poolRedeemedSupply[pool];

        uint256 withdrawAmt = (lpBalance * tokenBalance) / unredeemedSupply;
        poolRedeemedSupply[pool] += lpBalance;

        IERC20(token).safeTransfer(msg.sender, withdrawAmt);
    }

    function withdrawETH() external {
        uint256 lpBalance = IERC20(vault).balanceOf(msg.sender);
        require(lpBalance != 0, 'NO LIQUIDITY');

        IERC20(vault).safeTransferFrom(msg.sender, address(this), lpBalance);

        uint256 ethBalance = address(this).balance;
        uint256 vaultUnredeemedSupply = IERC20(vault).totalSupply() - vaultRedeemedSupply;

        uint256 withdrawAmt = (lpBalance * ethBalance) / vaultUnredeemedSupply;
        vaultRedeemedSupply += lpBalance;

        // solhint-disable-next-line avoid-low-level-calls
        (bool sent, ) = payable(msg.sender).call{ value: withdrawAmt }('');
        require(sent, 'Failed to send Ether');
    }

    function rescueTokens(address pool) external {
        require(msg.sender == guardian, 'ONLY GUARDIAN');
        address token = poolToToken[pool];
        require(token != address(0), 'INVALID POOL');

        uint256 tokenBalance = IERC20(token).balanceOf(address(this));
        require(tokenBalance != 0, 'NO TOKENS');

        IERC20(token).safeTransfer(guardian, tokenBalance);
        poolRedeemedSupply[pool] = 0;
    }

    function rescueETH() external {
        require(msg.sender == guardian, 'ONLY GUARDIAN');
        uint256 ethBalance = address(this).balance;

        require(ethBalance != 0, 'NO ETH');

        // solhint-disable-next-line avoid-low-level-calls
        (bool sent, ) = payable(guardian).call{ value: ethBalance }('');
        require(sent, 'Failed to send Ether');
        vaultRedeemedSupply = 0;
    }
}
