// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.6;

import '@openzeppelin/contracts/access/Ownable.sol';
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import './interfaces/IStableVaultV2.sol';
import './interfaces/IUniswapV2Router02.sol';
import './libraries/UniswapV2Library.sol';
import './StableVaultToken.sol';

contract StableVault is Ownable {
    using SafeERC20 for IERC20;

    address public constant uniswapFactory = 0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f;
    address public constant uniswapRouter = 0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D;
    address public constant usdc = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address public constant usdt = 0xdAC17F958D2ee523a2206206994597C13D831ec7;

    bool public liquidityAdded;
    bool public liquidityRemoved;

    StableVaultToken public svUsdc = new StableVaultToken(usdc);
    StableVaultToken public svUsdt = new StableVaultToken(usdt);

    address public pair = UniswapV2Library.pairFor(uniswapFactory, usdc, usdt);

    /// @notice the StableVault has 4 Phases, and actions are restricted based on which Phase it's in.
    enum Phases {
        Zero,
        One,
        Two,
        Three
    }

    /// @notice indicator which Phase StableVault is in. The owner can move the Vault to the next Phase.
    Phases public phase = Phases.Zero;

    /// @notice restricts actions based on the current Phase.
    modifier duringPhase(Phases _phase) {
        require(phase == _phase, 'Cannot execute this function during current phase');
        _;
    }

    /// @notice restricts actions to tokens USDC and USDT
    modifier validToken(address _token) {
        require(_token == usdc || _token == usdt, 'Invalid Token');
        _;
    }

    /// @notice allows users to deposit a token during Phase Zero
    /// @param _amount how much of the token to deposit, and how many staking tokens will be minted
    function depositToken(address _token, uint256 _amount) external duringPhase(Phases.Zero) validToken(_token) {
        IERC20(_token).safeTransferFrom(msg.sender, address(this), _amount);
        _token == usdc ? svUsdc.mint(msg.sender, _amount) : svUsdt.mint(msg.sender, _amount);
    }

    function withdrawToken(address _token, address _stableVaultV2)
        external
        validToken(_token)
        duringPhase(Phases.Three)
        returns (uint256 returnAmount)
    {
        StableVaultToken svToken = _token == usdc ? svUsdc : svUsdt;
        uint256 amount = svToken.balanceOf(msg.sender);
        require(amount > 0, 'No balance to withdraw');
        returnAmount = (IERC20(_token).balanceOf(address(this)) * amount) / svToken.totalSupply();
        svToken.burn(msg.sender, amount);
        if (_stableVaultV2 == address(0)) {
            IERC20(_token).safeTransfer(msg.sender, returnAmount);
        } else {
            if (_token == usdt) {
                IERC20(_token).safeApprove(_stableVaultV2, 0);
            }
            IERC20(_token).safeApprove(_stableVaultV2, returnAmount);
            IStableVaultV2(_stableVaultV2).migrateLiquidity(returnAmount, msg.sender);
        }
    }

    /// @notice called by the owner during phase 1
    function addLiquidity(uint256 _minUsdc, uint256 _minUsdt) external onlyOwner duringPhase(Phases.One) {
        uint256 usdcBalance = IERC20(usdc).balanceOf(address(this));
        uint256 usdtBalance = IERC20(usdt).balanceOf(address(this));

        IERC20(usdc).approve(uniswapRouter, usdcBalance);
        IERC20(usdt).safeApprove(uniswapRouter, usdtBalance);

        IUniswapV2Router02(uniswapRouter).addLiquidity(
            usdc,
            usdt,
            usdcBalance,
            usdtBalance,
            _minUsdc,
            _minUsdt,
            address(this),
            block.timestamp
        );
        liquidityAdded = true;
    }

    function removeLiquidity(uint256 _minUsdc, uint256 _minUsdt) external onlyOwner duringPhase(Phases.Two) {
        uint256 lpTokenBalance = IERC20(pair).balanceOf(address(this));
        IERC20(pair).approve(uniswapRouter, lpTokenBalance);
        IUniswapV2Router02(uniswapRouter).removeLiquidity(
            usdc,
            usdt,
            lpTokenBalance,
            _minUsdc,
            _minUsdt,
            address(this),
            block.timestamp
        );
        liquidityRemoved = true;
    }

    /// @notice allows the Vault owner to move the Vault into its next phase
    function nextPhase() external onlyOwner {
        if (phase == Phases.One) {
            require(liquidityAdded, 'Liquidity not added yet');
        } else if (phase == Phases.Two) {
            require(liquidityRemoved, 'Liquidity not removed yet');
        }
        phase = Phases(uint256(phase) + 1);
    }
}
