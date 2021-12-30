// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.6;
import '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import './interfaces/IPool.sol';

contract RiftV1Withdraw {
    using SafeERC20 for IERC20;
    address public vault;
    uint256 public vaultUnredeemedSupply;
    mapping(address => address) public poolToToken;
    mapping(address => uint256) public poolToUnredeemedSupply;
    address public guardian;

    constructor(
        address _vault,
        address[] memory pools,
        address _guardian
    ) {
        vault = _vault;
        guardian = _guardian;
        for (uint256 i = 0; i < pools.length; i++) {
            poolToToken[pools[i]] = IPool(pools[i]).token();
        }
    }

    function migrateLiquidity(uint256 amount) external {
        require(poolToToken[msg.sender] != address(0), 'ONLY POOL');
        IERC20(poolToToken[msg.sender]).safeTransferFrom(msg.sender, address(this), amount);
        poolToUnredeemedSupply[msg.sender] =
            IERC20(msg.sender).totalSupply() -
            IERC20(msg.sender).balanceOf(address(this));
    }

    function migrateLiquidity() external payable {
        require(msg.sender == vault, 'ONLY VAULT');
        vaultUnredeemedSupply = IERC20(msg.sender).totalSupply() - IERC20(msg.sender).balanceOf(address(this));
    }

    function withdrawToken(address pool) external {
        address token = poolToToken[pool];
        require(token != address(0), 'ONLY POOL');
        uint256 lpBalance = IERC20(pool).balanceOf(msg.sender);
        require(lpBalance != 0, 'NO LIQUIDITY');
        IERC20(pool).safeTransferFrom(msg.sender, address(this), lpBalance);
        uint256 tokenBalance = IERC20(token).balanceOf(address(this));
        uint256 withdrawAmt = (lpBalance * tokenBalance) / poolToUnredeemedSupply[pool];
        poolToUnredeemedSupply[pool] -= lpBalance;
        IERC20(token).safeTransfer(msg.sender, withdrawAmt);
    }

    function withdrawETH() external {
        uint256 lpBalance = IERC20(vault).balanceOf(msg.sender);
        require(lpBalance != 0, 'NO LIQUIDITY');
        IERC20(vault).safeTransferFrom(msg.sender, address(this), lpBalance);
        uint256 ethBalance = address(this).balance;
        uint256 withdrawAmt = (lpBalance * ethBalance) / vaultUnredeemedSupply;
        vaultUnredeemedSupply -= lpBalance;
        (bool sent, ) = payable(msg.sender).call{ value: withdrawAmt }('');
        require(sent, 'FAILED');
    }

    function rescueTokens(address[] calldata _tokens, uint256[] calldata _amounts) external {
        require(msg.sender == guardian, 'ONLY GUARD');
        uint256 amount = 0;
        for (uint256 i = 0; i < _tokens.length; i++) {
            if (_tokens[i] != address(0)) {
                amount = _amounts[i] == 0 ? IERC20(_tokens[i]).balanceOf(address(this)) : _amounts[i];
                IERC20(_tokens[i]).safeTransfer(msg.sender, amount);
            } else {
                amount = _amounts[i] == 0 ? address(this).balance : _amounts[i];
                (bool sent, ) = payable(msg.sender).call{ value: amount }('');
                require(sent, 'FAILED');
            }
        }
    }
}
