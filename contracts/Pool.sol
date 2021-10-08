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

contract Pool is ERC20 {
    address public constant sushi = 0x6B3595068778DD592e39A122f4f5a5cF09C90fE2;
    address public constant sushiFactory = 0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac;
    address public constant sushiRouter = 0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F;
    address public constant masterChef = 0xc2EdaD668740f1aA35E4D8f227fB8E17dcA888Cd;
    address public constant masterChefV2 = 0xEF0881eC094552b2e128Cf945EF17a6752B4Ec5d;
    address public constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;

    bool public immutable isMasterChefV2;
    address public immutable token;
    address public immutable pair;
    uint256 public immutable pid;
    IVault public immutable vault;

    uint256 public depositTimestamp;
    uint256 public initialWethDeposit;
    uint256 public lpTokenBalance;

    modifier duringPhase(IVault.Phases _phase) {
        require(vault.phase() == _phase, 'Cannot execute this function during current phase');
        _;
    }

    modifier onlyVault() {
        require(msg.sender == address(vault), 'Only Vault');
        _;
    }

    constructor(
        address _vaultAddress,
        address _token,
        uint256 _pid,
        bool _isMasterChefV2
    )
        ERC20(
            string(abi.encodePacked('Rift ', ERC20(_token).name(), ' Pool')),
            string(abi.encodePacked('rp', ERC20(_token).symbol()))
        )
    {
        vault = IVault(_vaultAddress);
        token = _token;
        pid = _pid;
        isMasterChefV2 = _isMasterChefV2;
        pair = UniswapV2Library.pairFor(sushiFactory, _token, WETH);
    }

    function depositToken(uint256 _amount) external duringPhase(IVault.Phases.Zero) {
        IERC20(token).transferFrom(msg.sender, address(this), _amount);
        _mint(msg.sender, _amount);
    }

    function withdrawToken(uint256 _amount, address _poolV2)
        external
        duringPhase(IVault.Phases.Two)
        returns (uint256 returnAmount)
    {
        require(balanceOf(msg.sender) >= _amount, 'Withdraw amount exceeds balance');
        returnAmount = (IERC20(token).balanceOf(address(this)) * _amount) / totalSupply();
        _burn(msg.sender, _amount);
        if (_poolV2 == address(0)) {
            IERC20(token).transfer(msg.sender, returnAmount);
        } else {
            IERC20(token).approve(_poolV2, returnAmount);
            IPoolV2(_poolV2).migrateLiquidity(returnAmount, msg.sender);
        }
    }

    function tokenShare(address _account) external view duringPhase(IVault.Phases.Two) returns (uint256 share) {
        uint256 stakingTokenBalance = balanceOf(_account);
        share = (IERC20(token).balanceOf(address(this)) * stakingTokenBalance) / totalSupply();
    }

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

    function stake(uint256 _lpTokenBalance) internal virtual {
        if (isMasterChefV2) {
            IERC20(pair).approve(masterChefV2, _lpTokenBalance);
            IMasterChefV2(masterChefV2).deposit(pid, _lpTokenBalance, address(this));
        } else {
            IERC20(pair).approve(masterChef, _lpTokenBalance);
            IMasterChef(masterChef).deposit(pid, _lpTokenBalance);
        }
    }

    function unstake(uint256 _lpTokenBalance) internal virtual {
        if (isMasterChefV2) {
            IMasterChefV2(masterChefV2).withdrawAndHarvest(pid, _lpTokenBalance, address(this));
        } else {
            IMasterChef(masterChef).withdraw(pid, _lpTokenBalance);
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

    function getPath(address _from, address _to) private pure returns (address[] memory path) {
        path = new address[](2);
        path[0] = _from;
        path[1] = _to;
    }
}
