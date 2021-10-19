// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.6;

import '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import './interfaces/IMasterChef.sol';
import './interfaces/IMasterChefV2.sol';
import './interfaces/IPoolV2.sol';
import './interfaces/IUniswapV2Router02.sol';
import './interfaces/IVault.sol';
import './interfaces/IWETH.sol';
import './libraries/SushiSwapLibrary.sol';

/// @title Rift V1 Pool
/// @notice allows users to deposit an ERC token that will be paired with ETH and deployed to a Sushiswap pool.
contract Pool is ERC20 {
    using SafeERC20 for IERC20;

    /// @notice addresses for various contracts that the Pool will interact with
    address public constant sushi = 0x6B3595068778DD592e39A122f4f5a5cF09C90fE2;
    address public constant sushiFactory = 0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac;
    address public constant sushiRouter = 0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F;
    address public constant masterChef = 0xc2EdaD668740f1aA35E4D8f227fB8E17dcA888Cd;
    address public constant masterChefV2 = 0xEF0881eC094552b2e128Cf945EF17a6752B4Ec5d;
    address public constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;

    /// @notice an ERC20 compliant token that can be deposited into this contract
    address public immutable token;
    /// @notice Sushiswap pair for this token <> WETH
    address public immutable pair;
    /// @notice the Sushiswap pool ID for the MasterChef or MasterChefV2 contracts
    uint256 public immutable pid;
    /// @notice the fixed rate (numerator out of 1000) returned to token depositors at the end of the period
    uint256 public immutable fixedRate;
    /// @notice the Rift V1 Vault
    IVault public immutable vault;

    /// @notice tracks the intitial WETH deposit amount, so the Pool can calculate how much must be returned
    uint256 public tokenPrincipalAmount;
    /// @notice the SLP tokens received after the pool adds liquidity
    uint256 public lpTokenBalance;
    /// @notice initial timestamp on which fixed rate begins. set by the owner after all liquidity has been
    /// paired with pools
    uint256 public depositTimestamp;

    /// @notice indicator how the SLP tokens can be staked to receive staking rewards
    enum SushiRewarder {
        None,
        MasterChef,
        MasterChefV2
    }
    SushiRewarder public immutable sushiRewarder;

    /// @notice restricts actions based on which Phase the vault is in
    modifier duringPhase(IVault.Phases _phase) {
        require(vault.phase() == _phase, 'Cannot execute this function during current phase');
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
    /// @param _sushiRewarder how the SLP tokens receive staking rewards - MasterChef, MasterChefV2, or None
    /// @param _pid the Sushiswap pool ID in the relevant sushiRewarder
    /// @param _fixedRate the fixed rate that that will be returned to token depositors for this pool
    constructor(
        address _vaultAddress,
        address _token,
        uint256 _sushiRewarder,
        uint256 _pid,
        uint256 _fixedRate
    )
        ERC20(
            string(abi.encodePacked('Rift ', ERC20(_token).name(), ' Pool V1')),
            string(abi.encodePacked('rp', ERC20(_token).symbol(), 'v1'))
        )
    {
        vault = IVault(_vaultAddress);
        token = _token;
        pid = _pid;
        sushiRewarder = SushiRewarder(_sushiRewarder);
        fixedRate = _fixedRate;
        pair = SushiSwapLibrary.pairFor(sushiFactory, _token, WETH);
    }

    /// @notice emitted after a successful deposit
    /// @param user the address that deposited into the Pool
    /// @param amount the amount that was deposited
    event Deposit(address indexed user, uint256 amount);

    /// @notice emitted after a successful withdrawal
    /// @param user the address that withdrew from the Pool
    /// @param amount The amount of token that was withdrawn
    event Withdraw(address indexed user, uint256 amount);

    /// @notice emitted after a successful migration
    /// @param user the address that migrated from the Pool
    /// @param amount The amount of token that was migrated
    event Migration(address indexed user, uint256 amount);

    /// @notice allows users to deposit the pool's token during Phase Zero
    /// @param _amount how much of the token to deposit, and how many staking tokens will be minted
    function depositToken(uint256 _amount) external duringPhase(IVault.Phases.Zero) {
        IERC20(token).safeTransferFrom(msg.sender, address(this), _amount);
        _mint(msg.sender, _amount);
        emit Deposit(msg.sender, _amount);
    }

    /// @notice allows user to withdraw or migrate from the pool during Phase Two
    /// @param _poolV2 if the user wishes to migrate their token to Rift's V2 Pools, they can
    /// do so by setting this parameter as a valid V2 pool address.
    function withdrawToken(address _poolV2) external duringPhase(IVault.Phases.Two) {
        uint256 amount = balanceOf(msg.sender);
        require(amount > 0, 'User has no balance');
        uint256 returnAmount = (IERC20(token).balanceOf(address(this)) * amount) / totalSupply();
        _burn(msg.sender, amount);
        if (_poolV2 == address(0)) {
            IERC20(token).safeTransfer(msg.sender, returnAmount);
            emit Withdraw(msg.sender, returnAmount);
        } else {
            IERC20(token).safeApprove(_poolV2, 0);
            IERC20(token).safeApprove(_poolV2, returnAmount);
            IPoolV2(_poolV2).migrateLiquidity(returnAmount, msg.sender);
            emit Migration(msg.sender, returnAmount);
        }
    }

    /// @notice helper function to view a user's proportional share of token during phase two
    /// @param _account the account of the user whose share is being requested
    function tokenShare(address _account) external view returns (uint256 share) {
        uint256 stakingTokenBalance = balanceOf(_account);
        share = (IERC20(token).balanceOf(address(this)) * stakingTokenBalance) / totalSupply();
    }

    /// @notice function to add liquidity to the token <> WETH SushiSwap pool and stake the SLP tokens
    /// Can only be called by the Vault. The only Vault function that calls this is `pairLiquidityPool`
    /// which in turn is only callable by the Vault Owner. The Vault sends some amount of ETH to the Pool, then
    /// calls this function. The Vault owner can set min amounts, but sufficient actions should be taken
    /// to prevent frontrunning.
    /// @param _amountWeth the amount of WETH that was sent by the Vault to this Pool. And the amount that the
    /// Pool must provide a return on by the end of Phase One.
    /// @param _amountToken the desired amount of token to add as liquidity to the sushi pool
    /// @param _minAmountWeth the minimum amount of WETH to deposit
    /// @param _minAmountToken the minimum amount of token to deposit
    function pairLiquidity(
        uint256 _amountWeth,
        uint256 _amountToken,
        uint256 _minAmountWeth,
        uint256 _minAmountToken
    ) external onlyVault returns (uint256) {
        IWETH(WETH).approve(sushiRouter, _amountWeth);
        IERC20(token).safeApprove(sushiRouter, 0);
        IERC20(token).safeApprove(sushiRouter, _amountToken);

        (uint256 wethDeposited, uint256 tokenDeposited, uint256 lpTokensReceived) = IUniswapV2Router02(sushiRouter)
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
        depositTimestamp = block.timestamp;

        if (wethDeposited < _amountWeth) {
            uint256 wethSurplus = _amountWeth - wethDeposited;
            IWETH(WETH).transfer(address(vault), wethSurplus);
        }

        stake(lpTokensReceived);
        return wethDeposited;
    }

    /// @notice function to unstake SLP tokens, remove liquidity from the token <> WETH SushiSwap pool,
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
        unstake(lpTokenBalance);

        IERC20(pair).approve(sushiRouter, lpTokenBalance);
        (, uint256 tokenReceived) = IUniswapV2Router02(sushiRouter).removeLiquidity(
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
            IERC20(token).safeApprove(sushiRouter, 0);
            IERC20(token).safeApprove(sushiRouter, tokenSurplus);
            wethBalance += IUniswapV2Router02(sushiRouter).swapExactTokensForTokens(
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

            (uint256 reserveToken, uint256 reserveWETH) = SushiSwapLibrary.getReserves(sushiFactory, token, WETH);
            uint256 wethQuote = SushiSwapLibrary.getAmountIn(tokenDeficit, reserveWETH, reserveToken);

            IWETH(WETH).approve(sushiRouter, wethBalance);
            if (wethQuote <= wethBalance) {
                // if the required amount of WETH is less than the current WETH balance of the Pool, swap only the
                // required amount of WETH
                wethBalance -= IUniswapV2Router02(sushiRouter).swapTokensForExactTokens(
                    tokenDeficit,
                    wethBalance,
                    getPath(WETH, token),
                    address(this),
                    block.timestamp
                )[0];
            } else {
                // if the required amount of WETH is greater than the current WETH balance of the Pool, swap
                // all remaining WETH to `token` to pay back as much as possible
                wethBalance -= IUniswapV2Router02(sushiRouter).swapExactTokensForTokens(
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

    /// @notice helper function to stake SLP tokens based on the sushiRewarder type. A virtual
    /// function so that any tokens with unique staking mechanics can simply inherit this contract
    /// and define their own stake function.
    /// @param _lpTokenAmount the amount of LP tokens to stake, received after depositing
    /// liquidity into the Sushi Pool
    function stake(uint256 _lpTokenAmount) internal virtual {
        if (sushiRewarder == SushiRewarder.None) {
            return;
        } else if (sushiRewarder == SushiRewarder.MasterChef) {
            IERC20(pair).approve(masterChef, _lpTokenAmount);
            IMasterChef(masterChef).deposit(pid, _lpTokenAmount);
        } else {
            IERC20(pair).approve(masterChefV2, _lpTokenAmount);
            IMasterChefV2(masterChefV2).deposit(pid, _lpTokenAmount, address(this));
        }
    }

    /// @notice helper function to unstake SLP tokens based on the sushiRewarder type. A virtual
    /// function so that any tokens with unique staking mechanics can simply inherit this contract
    /// and define their own unstake function
    /// @param _lpTokenAmount the amount of LP tokens to stake, received after depositing
    /// liquidity into the Sushi Pool
    function unstake(uint256 _lpTokenAmount) internal virtual {
        if (sushiRewarder == SushiRewarder.None) {
            return;
        } else if (sushiRewarder == SushiRewarder.MasterChef) {
            IMasterChef(masterChef).withdraw(pid, _lpTokenAmount);
        } else {
            IMasterChefV2(masterChefV2).withdrawAndHarvest(pid, _lpTokenAmount, address(this));
        }

        uint256 sushiBalance = IERC20(sushi).balanceOf(address(this));
        IERC20(sushi).approve(sushiRouter, sushiBalance);
        IUniswapV2Router02(sushiRouter).swapExactTokensForTokens(
            sushiBalance,
            0,
            getPath(sushi, WETH),
            address(this),
            block.timestamp
        );
    }

    /// @notice converts two addresses into an address[] type
    function getPath(address _from, address _to) private pure returns (address[] memory path) {
        path = new address[](2);
        path[0] = _from;
        path[1] = _to;
    }
}
