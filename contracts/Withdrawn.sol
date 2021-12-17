// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.6;
import '@openzeppelin/contracts/access/Ownable.sol';
import '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import './interfaces/IPool.sol';
import './interfaces/IVaultV2.sol';
import './interfaces/IWETH.sol';
import './Vault.sol';

contract Withdrawn {
    address public vault;
    uint256 public vaultUnredeemedSupply;
    mapping(address => address) public poolToToken;
    mapping(address => uint256) public poolToUnredeemedSupply;
    mapping(address => mapping(address => bool)) public withdrawn;

    constructor(address _vault, address[] memory pools) {
        vault = _vault;
        for (uint256 i = 0; i < pools.length; i++) {
            poolToToken[pools[i]] = IPool(pools[i]).token();
        }
    }

    function migrateLiquidity(uint256 amount) external {
        require(poolToToken[msg.sender] != address(0), 'Only Rift V1 Pool Could Migrate Liquidity');
        IERC20(poolToToken[msg.sender]).transferFrom(msg.sender, address(this), amount);
        poolToUnredeemedSupply[msg.sender] = IERC20(msg.sender).totalSupply();
    }

    function migrateLiquidity() external payable {
        require(msg.sender == vault, 'Only Vault Address Could Migrate Liquidity');
        vaultUnredeemedSupply = IERC20(msg.sender).totalSupply();
    }

    function withdrawToken(address pool) external {
        address token = poolToToken[pool];
        require(token != address(0), 'Withdraw Pool Needs to be a Rift V1 Pool');
        uint256 lpBalance = IERC20(pool).balanceOf(msg.sender);
        require(lpBalance != 0, 'No Deposited Liquidity');
        require(withdrawn[pool][msg.sender] == false, 'Already Withdrawn');
        withdrawn[pool][msg.sender] = true;
        uint256 tokenBalance = IERC20(token).balanceOf(address(this));
        uint256 withdrawAmt = (lpBalance * tokenBalance) / poolToUnredeemedSupply[pool];
        poolToUnredeemedSupply[pool] -= lpBalance;
        IERC20(token).transfer(msg.sender, withdrawAmt);
    }

    function withdrawETH() external {
        uint256 lpBalance = IERC20(vault).balanceOf(msg.sender);
        require(lpBalance != 0, 'No Deposited Liquidity');
        require(withdrawn[vault][msg.sender] == false, 'Already Withdrawn');
        withdrawn[vault][msg.sender] = true;
        uint256 ethBalance = address(this).balance;
        uint256 withdrawAmt = (lpBalance * ethBalance) / vaultUnredeemedSupply;
        vaultUnredeemedSupply -= lpBalance;
        payable(msg.sender).transfer(withdrawAmt);
    }
}
