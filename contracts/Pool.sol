// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.6;

import '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import './interfaces/IMasterChef.sol';
import './interfaces/IMasterChefV2.sol';
import './interfaces/IPoolV2.sol';
import './interfaces/IUniswapV2Router02.sol';
import './interfaces/IVault.sol';
import './interfaces/IWETH.sol';
import './libraries/UniswapV2Library.sol';

/// @title Rift V1 Pool
/// @notice allows users to deposit an ERC token that will be paired with ETH and deployed to a Sushiswap pool.
contract Pool is ERC20 {
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
    /// @notice the Rift V1 Vault
    IVault public immutable vault;

    /// @notice tracks when WETH was initially deployed by the Vault into this pool
    uint256 public depositTimestamp;
    /// @notice tracks the intitial WETH deposit amount, so the Pool can calculate how much must be returned
    uint256 public initialWethDeposit;
    /// @notice the SLP tokens received after the pool adds liquidity
    uint256 public lpTokenBalance;

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
    constructor(
        address _vaultAddress,
        address _token,
        uint256 _sushiRewarder,
        uint256 _pid
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
        pair = UniswapV2Library.pairFor(sushiFactory, _token, WETH);
    }

    /// @notice allows users to deposit the pool's token during Phase Zero
    /// @param _amount how much of the token to deposit, and how many staking tokens will be minted
    function depositToken(uint256 _amount) external duringPhase(IVault.Phases.Zero) {
        IERC20(token).transferFrom(msg.sender, address(this), _amount);
        _mint(msg.sender, _amount);
    }

    /// @notice allows user to withdraw or migrate from the pool during Phase Two
    /// @param _poolV2 if the user wishes to migrate their token to Rift's V2 Pools, they can
    /// do so by setting this parameter as a valid V2 pool address.
    function withdrawToken(address _poolV2) external duringPhase(IVault.Phases.Two) returns (uint256 returnAmount) {
        uint256 amount = balanceOf(msg.sender);
        require(amount > 0, 'User has no balance');
        returnAmount = (IERC20(token).balanceOf(address(this)) * amount) / totalSupply();
        _burn(msg.sender, amount);
        if (_poolV2 == address(0)) {
            IERC20(token).transfer(msg.sender, returnAmount);
        } else {
            IERC20(token).approve(_poolV2, returnAmount);
            IPoolV2(_poolV2).migrateLiquidity(returnAmount, msg.sender);
        }
    }

    /// @notice helper function to view a user's proportional share of token during phase two
    /// @param _account the account of the user whose share is being requested
    function tokenShare(address _account) external view duringPhase(IVault.Phases.Two) returns (uint256 share) {
        uint256 stakingTokenBalance = balanceOf(_account);
        share = (IERC20(token).balanceOf(address(this)) * stakingTokenBalance) / totalSupply();
    }

    /// @notice function to add liquidity to the token <> WETH SushiSwap pool and stake the SLP tokens
    /// Can only be called by the Vault. The only Vault function that calls this is `pairLiquidityPool`
    /// which in turn is only callable by the Vault Owner. The Vault sends some amount of ETH to the Pool, then
    /// calls this function
    /// @param _amount the amount of WETH that was sent by the Vault to this Pool. And the amount that the
    /// Pool must provide a return on by the end of Phase One.
    function pairLiquidity(uint256 _amount) external onlyVault {
        initialWethDeposit = _amount;
        depositTimestamp = block.timestamp;

        uint256 tokenBalance = IERC20(token).balanceOf(address(this));
        uint256 wETHBalance = IWETH(WETH).balanceOf(address(this));

        IERC20(token).approve(sushiRouter, tokenBalance);
        IWETH(WETH).approve(sushiRouter, wETHBalance);

        (, , lpTokenBalance) = IUniswapV2Router02(sushiRouter).addLiquidity(
            token,
            WETH,
            tokenBalance,
            wETHBalance,
            0,
            0,
            address(this),
            block.timestamp
        );

        stake(lpTokenBalance);
    }

    /// @notice function to unstake SLP tokens, remove liquidity from the token <> WETH SushiSwap pool, and
    /// return WETH to the Vault contract based on the required fixed rate, the initial amount of WETH
    /// deposited by the Vault, and the timestamp of the initial WETH deposit. Based on these variables,
    /// the Pool may need to swap some of `token` for WETH to return the required fixed rate. If there is
    /// enough WETH to return the required amount, any remaining WETH is swapped for the `token`.
    /// Can only be called by the Vault. The only Vault function that calls this is `unpairLiquidityPool`
    /// which in turn is only callable by the Vault Owner.
    function unpairLiquidity() external onlyVault {
        unstake(lpTokenBalance);

        IERC20(pair).approve(sushiRouter, lpTokenBalance);
        IUniswapV2Router02(sushiRouter).removeLiquidity(
            token,
            WETH,
            lpTokenBalance,
            0,
            0,
            address(this),
            block.timestamp
        );

        uint256 wethOwed = initialWethDeposit +
            (((initialWethDeposit * vault.fixedRate()) / 100) * (block.timestamp - depositTimestamp)) /
            (365 days);
        uint256 wethBalance = IWETH(WETH).balanceOf(address(this));

        if (wethBalance >= wethOwed) {
            IWETH(WETH).transfer(address(vault), wethOwed);
            wethBalance -= wethOwed;

            if (wethBalance > 0) {
                IWETH(WETH).approve(sushiRouter, wethBalance);
                IUniswapV2Router02(sushiRouter).swapExactTokensForTokens(
                    wethBalance,
                    0,
                    getPath(WETH, token),
                    address(this),
                    block.timestamp
                );
            }
        } else {
            uint256 tokenBalance = IERC20(token).balanceOf(address(this));
            uint256 wethDeficit = wethOwed - wethBalance;

            (uint256 reserveToken, uint256 reserveWETH) = UniswapV2Library.getReserves(sushiFactory, token, WETH);
            uint256 tokenQuote = UniswapV2Library.getAmountIn(wethDeficit, reserveToken, reserveWETH);

            IERC20(token).approve(sushiRouter, tokenBalance);
            if (tokenQuote <= tokenBalance) {
                wethBalance += IUniswapV2Router02(sushiRouter).swapTokensForExactTokens(
                    wethDeficit,
                    tokenBalance,
                    getPath(token, WETH),
                    address(this),
                    block.timestamp
                )[1];
                IWETH(WETH).transfer(address(vault), wethBalance);
            } else {
                wethBalance += IUniswapV2Router02(sushiRouter).swapExactTokensForTokens(
                    tokenBalance,
                    0,
                    getPath(token, WETH),
                    address(this),
                    block.timestamp
                )[1];
                IWETH(WETH).transfer(address(vault), wethBalance);
            }
        }
    }

    /// @notice helper function to stake SLP tokens based on the sushiRewarder type. A virtual
    /// function so that any tokens with unique staking mechanics can simply inherit this contract
    /// and define their own stake function.
    /// @param _lpTokenBalance the amount of LP tokens to stake, received after depositing
    /// liquidity into the Sushi Pool
    function stake(uint256 _lpTokenBalance) internal virtual {
        if (sushiRewarder == SushiRewarder.None) {
            return;
        } else if (sushiRewarder == SushiRewarder.MasterChef) {
            IERC20(pair).approve(masterChef, _lpTokenBalance);
            IMasterChef(masterChef).deposit(pid, _lpTokenBalance);
        } else {
            IERC20(pair).approve(masterChefV2, _lpTokenBalance);
            IMasterChefV2(masterChefV2).deposit(pid, _lpTokenBalance, address(this));
        }
    }

    /// @notice helper function to unstake SLP tokens based on the sushiRewarder type. A virtual
    /// function so that any tokens with unique staking mechanics can simply inherit this contract
    /// and define their own unstake function
    /// @param _lpTokenBalance the amount of LP tokens to stake, received after depositing
    /// liquidity into the Sushi Pool
    function unstake(uint256 _lpTokenBalance) internal virtual {
        if (sushiRewarder == SushiRewarder.None) {
            return;
        } else if (sushiRewarder == SushiRewarder.MasterChef) {
            IMasterChef(masterChef).withdraw(pid, _lpTokenBalance);
        } else {
            IMasterChefV2(masterChefV2).withdrawAndHarvest(pid, _lpTokenBalance, address(this));
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
