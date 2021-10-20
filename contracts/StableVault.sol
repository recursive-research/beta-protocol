// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.6;

import '@openzeppelin/contracts/access/Ownable.sol';
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import '@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol';
import './interfaces/IStableVaultV2.sol';
import './interfaces/IUniswapV2Router02.sol';
import './libraries/UniswapV2Library.sol';
import './StableVaultToken.sol';

/// @title Rift V1 StableVault
/// @notice allows users to Deposit USDC or USDT that will be deployed to a Uniswap Pool
contract StableVault is Ownable {
    using SafeERC20 for IERC20;

    /// @notice addresses for various contracts that the Pool will interact with
    address public constant uniswapFactory = 0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f;
    address public constant uniswapRouter = 0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D;
    address public constant uniswapV3Router = 0xE592427A0AEce92De3Edee1F18E0157C05861564;
    address public immutable usdc;
    address public immutable usdt;

    /// @notice state variables to track phases of the contract
    bool public liquidityAdded;
    bool public liquidityRemoved;

    /// @notice ERC20s that will be minted and burned on USDC/USDC deposit/withdraw
    StableVaultToken public immutable svUsdc;
    StableVaultToken public immutable svUsdt;

    /// @notice LP tokens for the USDC-USDT UniswapV2 Pool
    address public immutable pair;

    /// @notice restricts actions to USDC and USDT
    modifier validToken(address _token) {
        require(_token == usdc || _token == usdt, 'Invalid Token');
        _;
    }

    /// @notice emitted after a successful deposit
    /// @param token USDC or USDC
    /// @param user the address that deposited into the StableVault
    /// @param amount the amount that was deposited
    event Deposit(address indexed token, address indexed user, uint256 amount);

    /// @notice emitted after a successful withdrawal
    /// @param token USDC or USDC
    /// @param user the address that withdrew from the StableVault
    /// @param amount The amount of token that was withdrawn
    event Withdraw(address indexed token, address indexed user, uint256 amount);

    /// @notice emitted after a successful migration
    /// @param token USDC or USDC
    /// @param user the address that migrated from the StableVault
    /// @param amount The amount of token that was migrated
    event Migration(address indexed token, address indexed user, uint256 amount);

    constructor(address _usdc, address _usdt) {
        require(_usdc != address(0), 'Invalid USDC address');
        require(_usdt != address(0), 'Invalid USDT address');
        usdc = _usdc;
        usdt = _usdt;
        svUsdc = new StableVaultToken(_usdc);
        svUsdt = new StableVaultToken(_usdt);
        pair = UniswapV2Library.pairFor(uniswapFactory, _usdc, _usdt);
    }

    /// @notice allows users to deposit a token before liquidity has been deployed. Mints
    /// the user a StableVaultToken ERC20 based on which token they deposit
    /// @param _token token to deposit - USDC or USDT
    /// @param _amount how much of the token to deposit, and how many staking tokens will be minted
    function depositToken(address _token, uint256 _amount) external validToken(_token) {
        require(!liquidityAdded, 'Liquidity already deployed');
        IERC20(_token).safeTransferFrom(msg.sender, address(this), _amount);
        _token == usdc ? svUsdc.mint(msg.sender, _amount) : svUsdt.mint(msg.sender, _amount);
        emit Deposit(_token, msg.sender, _amount);
    }

    /// @notice allows user to withdraw or migrate from the StableVault at the end. Can only be withdrawn
    /// after the Uniswap LP tokens have been withdraw and converted back to USDC/USDT
    /// @param _token token to deposit - USDC or USDT
    /// @param _stableVaultV2 if the user wishes to migrate their tokens to Rift's V2 StableVaults,
    /// they can do so by setting this parameter as a vaild V2 StableVault address
    function withdrawToken(address _token, address _stableVaultV2)
        external
        validToken(_token)
        returns (uint256 returnAmount)
    {
        require(liquidityRemoved, 'Liquidity not yet removed');
        StableVaultToken svToken = _token == usdc ? svUsdc : svUsdt;
        uint256 amount = svToken.balanceOf(msg.sender);
        require(amount > 0, 'No balance to withdraw');
        returnAmount = (IERC20(_token).balanceOf(address(this)) * amount) / svToken.totalSupply();
        svToken.burn(msg.sender, amount);
        if (_stableVaultV2 == address(0)) {
            IERC20(_token).safeTransfer(msg.sender, returnAmount);
            emit Withdraw(_token, msg.sender, returnAmount);
        } else {
            IERC20(_token).safeApprove(_stableVaultV2, 0);
            IERC20(_token).safeApprove(_stableVaultV2, returnAmount);
            IStableVaultV2(_stableVaultV2).migrateLiquidity(returnAmount, msg.sender);
            emit Migration(_token, msg.sender, returnAmount);
        }
    }

    /// @notice called by the owner after tokens have been deposited. Adds maximum amounts
    /// of USDT and USDC to the UniswapV2 Pool. If the ratio of USDC <> USDT is imbalanced
    /// the caller of this function can specify an amount to swap that will balance the ratio
    /// @param _minUsdc minimum amount of USDC to submit to the Pool. Set by the owner
    /// to prevent frontrunning
    /// @param _minUsdt minimum amount of USDT to submit to the Pool. Set by the owner
    /// to prevent frontrunning
    /// @param _swapAmountIn if swapping imbalanced tokens, the amount in to swap
    /// @param _swapAmountOutMin if swapping imbalanced tokens, the minimum amount to receive
    /// on the swap
    /// @param _swapUsdc if true, swap USDC for USDT. If false, the opposite.
    function addLiquidity(
        uint256 _minUsdc,
        uint256 _minUsdt,
        uint256 _swapAmountIn,
        uint256 _swapAmountOutMin,
        bool _swapUsdc
    ) external onlyOwner {
        require(!liquidityRemoved, 'Liquidity already removed');

        if (_swapAmountIn > 0) {
            address tokenIn = _swapUsdc ? usdc : usdt;
            address tokenOut = _swapUsdc ? usdt : usdc;

            IERC20(tokenIn).safeApprove(uniswapV3Router, 0);
            IERC20(tokenIn).safeApprove(uniswapV3Router, _swapAmountIn);
            ISwapRouter.ExactInputSingleParams memory params = ISwapRouter.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: 500,
                recipient: address(this),
                deadline: block.timestamp,
                amountIn: _swapAmountIn,
                amountOutMinimum: _swapAmountOutMin,
                sqrtPriceLimitX96: 0
            });

            ISwapRouter(uniswapV3Router).exactInputSingle(params);
        }

        uint256 usdcBalance = IERC20(usdc).balanceOf(address(this));
        uint256 usdtBalance = IERC20(usdt).balanceOf(address(this));

        IERC20(usdc).approve(uniswapRouter, usdcBalance);
        IERC20(usdt).safeApprove(uniswapRouter, 0);
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

    /// @notice called by the owner after liquidity has been deployed to remove liquidity
    /// from the UniswapV2 pool. if the pool was imbalanced, the caller of this function can
    /// specify some amount swap back to an even balance.
    /// @param _minUsdc minimum amount of USDC to receive from the Pool. Set by the owner
    /// to prevent frontrunning
    /// @param _minUsdt minimum amount of USDT to receive from the Pool. Set by the owner
    /// to prevent frontrunning
    /// @param _swapAmountIn if swapping imbalanced tokens, the amount in to swap
    /// @param _swapAmountOutMin if swapping imbalanced tokens, the minimum amount to receive
    /// on the swap
    /// @param _swapUsdc if true, swap USDC for USDT. If false, the opposite.
    function removeLiquidity(
        uint256 _minUsdc,
        uint256 _minUsdt,
        uint256 _swapAmountIn,
        uint256 _swapAmountOutMin,
        bool _swapUsdc
    ) external onlyOwner {
        require(liquidityAdded, 'Liquidity not yet deployed');
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

        if (_swapAmountIn > 0) {
            address tokenIn = _swapUsdc ? usdc : usdt;
            address tokenOut = _swapUsdc ? usdt : usdc;

            IERC20(tokenIn).safeApprove(uniswapV3Router, 0);
            IERC20(tokenIn).safeApprove(uniswapV3Router, _swapAmountIn);
            ISwapRouter.ExactInputSingleParams memory params = ISwapRouter.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: 500,
                recipient: address(this),
                deadline: block.timestamp,
                amountIn: _swapAmountIn,
                amountOutMinimum: _swapAmountOutMin,
                sqrtPriceLimitX96: 0
            });

            ISwapRouter(uniswapV3Router).exactInputSingle(params);
        }

        liquidityRemoved = true;
    }
}
