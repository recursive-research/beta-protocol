// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.6;

import '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import './interfaces/IVault.sol';

contract Pool is ERC20 {
    IVault public immutable vault;
    ERC20 public immutable token;

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
        token = ERC20(_token);
    }

    function depositToken(uint256 amount) external duringPhase(IVault.Phases.Zero) {
        token.transferFrom(msg.sender, address(this), amount);
        _mint(msg.sender, amount);
    }

    function withdrawToken(uint256 amount) external duringPhase(IVault.Phases.Two) returns (uint256 returnAmount) {
        require(balanceOf(msg.sender) >= amount, 'Withdraw amount exceeds balance');
        returnAmount = (token.balanceOf(address(this)) * amount) / totalSupply();
        _burn(msg.sender, amount);
        token.transfer(msg.sender, returnAmount);
    }
}
