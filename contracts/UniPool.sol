// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.6;

import '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import './interfaces/IPoolV2.sol';
import './interfaces/IUniswapV2Router02.sol';
import './interfaces/IVault.sol';
import './interfaces/IWETH.sol';
import './libraries/UniswapV2Library.sol';

/// @title Rift V1 Uniswap Pool
/// @notice allows users to deposit an ERC token that will be paired with ETH and deployed to a Uniswap pool.
contract UniPool is ERC20 {
    using SafeERC20 for IERC20;

    /// @notice addresses for contracts that the Pool will interact with
    address public constant uniswapFactory = 0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f;
    address public constant uniswapRouter = 0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D;

    /// @notice an ERC20 compliant token that can be deposited into this contract
    address public immutable token;
    /// @notice weth9 address
    address public immutable WETH;
    /// @notice the fixed rate (numerator out of 1000) returned to token depositors at the end of the period
    uint256 public immutable fixedRate;
    /// @notice the Rift V1 Vault
    IVault public immutable vault;

    /// @notice Uniswap pair for this token <> WETH
    address public pair;
    /// @notice address that can migrate liquidity at end of the period
    address public migrator;
    /// @notice tracks the intitial token deposit amount, so the Pool can calculate how much must be returned
    uint256 public tokenPrincipalAmount;
    /// @notice the Uni LP tokens received after the pool adds liquidity
    uint256 public lpTokenBalance;
    /// @notice initial timestamp on which fixed rate begins. set by the owner after all liquidity has been
    /// paired with pools
    uint256 public depositTimestamp;

    /// @notice restricts actions based on which Phase the vault is in
    modifier duringPhase(IVault.Phases _phase) {
        require(vault.phase() == _phase, 'Invalid Phase function');
        _;
    }

    /// @notice actions that are restricted to the Rift V1 Vault
    modifier onlyVault() {
        require(msg.sender == address(vault), 'Only Vault');
        _;
    }

    /// @notice deploys a new Pool with an ERC20 compliant token
    /// @param _vaultAddress address of the Rift Eth Vault
    /// @param _token address of the token that the Pool will accept
    /// @param _fixedRate the fixed rate that that will be returned to token depositors for this pool
    /// @param _weth WETH9 address
    constructor(
        address _vaultAddress,
        address _token,
        uint256 _fixedRate,
        address _weth
    )
        ERC20(
            string(abi.encodePacked('Rift ', ERC20(_token).name(), ' Uni Pool V1')),
            string(abi.encodePacked('rp', ERC20(_token).symbol(), 'uv1'))
        )
    {
        require(_weth != address(0), 'Invalid weth address');
        require(_fixedRate < 1000, 'Invalid fixed rate');
        pair = UniswapV2Library.pairFor(uniswapFactory, _token, _weth);
        vault = IVault(_vaultAddress);
        token = _token;
        fixedRate = _fixedRate;
        WETH = _weth;
        migrator = msg.sender;
    }

    /// @notice emitted after a successful deposit
    /// @param user the address that deposited into the Pool
    /// @param amount the amount that was deposited
    event Deposit(address indexed user, uint256 amount);

    /// @notice emitted after a successful migration
    /// @param pool the pool to which liquidity was migrated
    /// @param amount The amount of token that was migrated
    event Migration(address indexed pool, uint256 amount);

    /// @notice allows users to deposit the pool's token during Phase Zero
    /// @param _amount how much of the token to deposit, and how many staking tokens will be minted
    function depositToken(uint256 _amount) external duringPhase(IVault.Phases.Zero) {
        _mint(msg.sender, _amount);
        emit Deposit(msg.sender, _amount);
        IERC20(token).safeTransferFrom(msg.sender, address(this), _amount);
    }

    /// @notice allows the contract owner to migrate liquidity to the next version of contracts
    /// @param _poolV2 address of the next version of this contract. Trusted to be benevolent.
    /// This Pool's staking token will be be redeemable for an equivalent value of the PoolV2's
    /// staking token
    function migrateLiquidity(address _poolV2) external duringPhase(IVault.Phases.Two) {
        require(msg.sender == migrator, 'only migrator');
        uint256 balance = IERC20(token).balanceOf(address(this));
        emit Migration(_poolV2, balance);

        IERC20(token).safeApprove(_poolV2, 0);
        IERC20(token).safeApprove(_poolV2, balance);
        IPoolV2(_poolV2).migrateLiquidity(balance);
    }

    /// @notice function to add liquidity to the token <> WETH Uniswap pool and stake the SLP tokens
    /// Can only be called by the Vault. The only Vault function that calls this is `pairLiquidityPool`
    /// which in turn is only callable by the Vault Owner. The Vault sends some amount of ETH to the Pool, then
    /// calls this function. The Vault owner can set min amounts, but sufficient actions should be taken
    /// to prevent frontrunning.
    /// @param _amountWeth the amount of WETH that was sent by the Vault to this Pool. And the amount that the
    /// Pool must provide a return on by the end of Phase One.
    /// @param _amountToken the desired amount of token to add as liquidity to the Uni pool
    /// @param _minAmountWeth the minimum amount of WETH to deposit
    /// @param _minAmountToken the minimum amount of token to deposit
    function pairLiquidity(
        uint256 _amountWeth,
        uint256 _amountToken,
        uint256 _minAmountWeth,
        uint256 _minAmountToken
    ) external onlyVault returns (uint256) {
        depositTimestamp = block.timestamp;

        IWETH(WETH).approve(uniswapRouter, _amountWeth);
        IERC20(token).safeApprove(uniswapRouter, 0);
        IERC20(token).safeApprove(uniswapRouter, _amountToken);

        (uint256 wethDeposited, uint256 tokenDeposited, uint256 lpTokensReceived) = IUniswapV2Router02(uniswapRouter)
            .addLiquidity(
                WETH,
                token,
                _amountWeth,
                _amountToken,
                _minAmountWeth,
                _minAmountToken,
                address(this),
                block.timestamp
            );

        tokenPrincipalAmount += tokenDeposited;
        lpTokenBalance += lpTokensReceived;

        if (wethDeposited < _amountWeth) {
            uint256 wethSurplus = _amountWeth - wethDeposited;
            IWETH(WETH).transfer(address(vault), wethSurplus);
        }

        return wethDeposited;
    }

    /// @notice function to remove liquidity from the token <> WETH Uniwap pool,
    /// calculate the required amount of `token` to be returned to the initial depositors, and send any
    /// surplus returns back to the Vault contract in the form of WETH. If the amount of `token` returned
    /// from staking and LP-ing is insufficient to return the required fixed rate, the pool may need to
    /// swap some of the WETH for `token`. If there is not enough to return the required amount of `token`
    /// to the depositors, the pool may need to swap the entire WETH balance for `token`.
    /// Can only be called by the Vault. The only Vault function that calls this is `unpairLiquidityPool`
    /// which in turn is only callable by the Vault Owner. The Vault owner can set min amounts, but
    /// sufficient actions should be taken to prevent frontrunning.
    /// @param _minAmountWeth the minimum amount of WETH to receive
    /// @param _minAmountToken the minimum amount of token to receive
    function unpairLiquidity(uint256 _minAmountWeth, uint256 _minAmountToken) external onlyVault {
        IERC20(pair).approve(uniswapRouter, lpTokenBalance);
        (, uint256 tokenReceived) = IUniswapV2Router02(uniswapRouter).removeLiquidity(
            WETH,
            token,
            lpTokenBalance,
            _minAmountWeth,
            _minAmountToken,
            address(this),
            block.timestamp
        );

        uint256 wethBalance = IWETH(WETH).balanceOf(address(this));
        // calculate the amount of `token` owed back to depositors. This is calculated as the initial principal
        // plus interest accrued during the period based on the pool's fixed rate, the initial deposit
        // amount, and the duration of deposit
        uint256 tokenOwed = tokenPrincipalAmount +
            (((tokenPrincipalAmount * fixedRate) / 1000) * (block.timestamp - depositTimestamp)) /
            (365 days);

        if (tokenReceived > tokenOwed) {
            // if the amount of tokens received back from the LP position is sufficient to pay back the fixed rate,
            // the pool swaps any surplus tokens to WETH.
            uint256 tokenSurplus = tokenReceived - tokenOwed;
            IERC20(token).safeApprove(uniswapRouter, 0);
            IERC20(token).safeApprove(uniswapRouter, tokenSurplus);
            wethBalance += IUniswapV2Router02(uniswapRouter).swapExactTokensForTokens(
                tokenSurplus,
                0,
                getPath(token, WETH),
                address(this),
                block.timestamp
            )[1];
        } else if (tokenReceived < tokenOwed) {
            // if the amount of tokens received back from the LP position is insufficient to pay back the fixed rate,
            // the pool swaps the required weth amount to `token` to pay back the `token` depositors.
            uint256 tokenDeficit = tokenOwed - tokenReceived;

            (uint256 reserveToken, uint256 reserveWETH) = UniswapV2Library.getReserves(uniswapFactory, token, WETH);
            uint256 wethQuote = UniswapV2Library.getAmountIn(tokenDeficit, reserveWETH, reserveToken);

            IWETH(WETH).approve(uniswapRouter, wethBalance);
            if (wethQuote <= wethBalance) {
                // if the required amount of WETH is less than the current WETH balance of the Pool, swap only the
                // required amount of WETH
                wethBalance -= IUniswapV2Router02(uniswapRouter).swapTokensForExactTokens(
                    tokenDeficit,
                    wethBalance,
                    getPath(WETH, token),
                    address(this),
                    block.timestamp
                )[0];
            } else {
                // if the required amount of WETH is greater than the current WETH balance of the Pool, swap
                // all remaining WETH to `token` to pay back as much as possible
                wethBalance -= IUniswapV2Router02(uniswapRouter).swapExactTokensForTokens(
                    wethBalance,
                    0,
                    getPath(WETH, token),
                    address(this),
                    block.timestamp
                )[0];
            }
        }

        if (wethBalance > 0) {
            IWETH(WETH).transfer(address(vault), wethBalance);
        }
    }

    /// @notice converts two addresses into an address[] type
    function getPath(address _from, address _to) private pure returns (address[] memory path) {
        path = new address[](2);
        path[0] = _from;
        path[1] = _to;
    }

    function updateMigrator(address _newMigrator) external {
        require(msg.sender == migrator, 'only migrator');
        migrator = _newMigrator;
    }
}
