// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.6;

import '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import './libraries/UniswapV2Library.sol';
import './interfaces/IUniswapV2Router02.sol';
import './interfaces/IVault.sol';

contract Pool is ERC20 {
    address public constant sushiFactory = 0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac;
    address public constant sushiRouter = 0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F;
    address public constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address public immutable token;
    IVault public immutable vault;

    modifier duringPhase(IVault.Phases _phase) {
        require(vault.phase() == _phase, 'Cannot execute this function during current phase');
        _;
    }

    constructor(address _vaultAddress, address _token)
        ERC20(
            string(abi.encodePacked('Rift ', ERC20(_token).name(), ' Pool')),
            string(abi.encodePacked('rp', ERC20(_token).symbol()))
        )
    {
        vault = IVault(_vaultAddress);
        token = _token;
    }

    function depositToken(uint256 amount) external duringPhase(IVault.Phases.Zero) {
        IERC20(token).transferFrom(msg.sender, address(this), amount);
        _mint(msg.sender, amount);
    }

    function withdrawToken(uint256 amount) external duringPhase(IVault.Phases.Two) returns (uint256 returnAmount) {
        require(balanceOf(msg.sender) >= amount, 'Withdraw amount exceeds balance');
        returnAmount = (IERC20(token).balanceOf(address(this)) * amount) / totalSupply();
        _burn(msg.sender, amount);
        IERC20(token).transfer(msg.sender, returnAmount);
    }

    function pairLiquidity() external {
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

        IUniswapV2Router02(sushiRouter).addLiquidity(
            token,
            WETH,
            tokenAmount,
            wETHAmount,
            (tokenAmount * 99) / 100,
            (wETHAmount * 99) / 100,
            address(this),
            block.timestamp
        );
    }
}
