// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.6;
import '@openzeppelin/contracts/access/Ownable.sol';
import '@openzeppelin/contracts/token/ERC20/ERC20.sol';

contract Vault is ERC20('RIFT - Fixed Rate ETH', 'frETH'), Ownable {
    uint256 public fixedRate;
    uint256 public maxEth;

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

    constructor(uint256 _fixedRate, uint256 _maxEth) {
        fixedRate = _fixedRate;
        maxEth = _maxEth;
    }

    function depositEth() external payable duringPhase(Phases.Zero) {
        require(address(this).balance <= maxEth, 'Max eth cap has been hit');
        _mint(msg.sender, msg.value);
    }

    function updateMaxEth(uint256 _maxEth) external onlyOwner duringPhase(Phases.Zero) {
        maxEth = _maxEth;
    }

    function executePhaseOne() external onlyOwner duringPhase(Phases.Zero) {
        phase = Phases.One;
    }

    function executePhaseTwo() external onlyOwner duringPhase(Phases.One) {
        phase = Phases.Two;
    }
}
