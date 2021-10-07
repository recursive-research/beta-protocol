// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.6;

import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import './libraries/UniswapV2Library.sol';
import './interfaces/IMasterChefV2.sol';
import './interfaces/IUniswapV2Router02.sol';
import './BasePool.sol';

contract PoolMasterChefV2 is BasePool {
    address public constant masterChefV2 = 0xEF0881eC094552b2e128Cf945EF17a6752B4Ec5d;

    constructor(
        address _vaultAddress,
        address _token,
        uint256 _pid
    ) BasePool(_vaultAddress, _token, _pid) {}

    function pairLiquidity() external override {
        require(msg.sender == address(vault), 'Only Vault');
        uint256 tokenBalance = IERC20(token).balanceOf(address(this));
        uint256 wETHBalance = IERC20(WETH).balanceOf(address(this));

        (uint256 reserveToken, uint256 reserveWETH) = UniswapV2Library.getReserves(sushiFactory, token, WETH);
        uint256 tokenQuote = UniswapV2Library.quote(wETHBalance, reserveWETH, reserveToken);

        uint256 tokenAmount;
        uint256 wETHAmount;

        if (tokenQuote <= tokenBalance) {
            tokenAmount = tokenQuote;
            wETHAmount = wETHBalance;
        } else {
            wETHAmount = UniswapV2Library.quote(tokenBalance, reserveToken, reserveWETH);
            tokenAmount = tokenBalance;
        }

        IERC20(token).approve(sushiRouter, tokenAmount);
        IERC20(WETH).approve(sushiRouter, wETHAmount);

        (, , lpTokenBalance) = IUniswapV2Router02(sushiRouter).addLiquidity(
            token,
            WETH,
            tokenAmount,
            wETHAmount,
            (tokenAmount * 99) / 100,
            (wETHAmount * 99) / 100,
            address(this),
            block.timestamp
        );

        address pair = UniswapV2Library.pairFor(sushiFactory, token, WETH);
        IERC20(pair).approve(masterChefV2, lpTokenBalance);
        IMasterChefV2(masterChefV2).deposit(pid, lpTokenBalance, address(this));
    }
}
