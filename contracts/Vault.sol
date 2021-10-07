// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.6;
import '@openzeppelin/contracts/access/Ownable.sol';
import '@openzeppelin/contracts/token/ERC20/ERC20.sol';

contract Vault is ERC20('RIFT - Fixed Rate ETH', 'frETH'), Ownable {
    uint256 public fixedRate;

    enum Phases {
        Zero,
        One,
        Two
    }

    Phases public phase = Phases.Zero;

    modifier duringPhase(Phases _phase) {
        require(phase == _phase, 'Cannot execute this function during current phase');
        _;
    }

    constructor(uint256 _fixedRate) {
        fixedRate = _fixedRate;
    }

    function depositEth() external payable duringPhase(Phases.Zero) {
        _mint(msg.sender, msg.value);
    }

    function executePhaseOne() public onlyOwner duringPhase(Phases.Zero) {
        phase = Phases.One;
    }

    function executePhaseTwo() public onlyOwner duringPhase(Phases.One) {
        phase = Phases.Two;
    }
}
