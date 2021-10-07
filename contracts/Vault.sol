// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.6;
import '@openzeppelin/contracts/access/Ownable.sol';
import '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import './interfaces/IPool.sol';
import './interfaces/IWETH.sol';

contract Vault is ERC20('RIFT - Fixed Rate ETH', 'frETH'), Ownable {
    address public constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
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

    receive() external payable {
        assert(msg.sender == WETH);
    }

    function depositEth() external payable duringPhase(Phases.Zero) {
        require(address(this).balance <= maxEth, 'Max eth cap has been hit');
        _mint(msg.sender, msg.value);
    }

    function withdrawEth(uint256 amount) external duringPhase(Phases.Two) returns (uint256 returnAmount) {
        require(balanceOf(msg.sender) >= amount, 'Withdraw amount exceeds balance');
        returnAmount = (address(this).balance * amount) / totalSupply();
        _burn(msg.sender, amount);
        payable(msg.sender).transfer(returnAmount);
    }

    function updateMaxEth(uint256 _maxEth) external onlyOwner duringPhase(Phases.Zero) {
        maxEth = _maxEth;
    }

    function executePhaseOne(address[] calldata _pools, uint256[] calldata _allocations)
        external
        onlyOwner
        duringPhase(Phases.Zero)
    {
        phase = Phases.One;
        uint256 ethBalance = address(this).balance;
        IWETH(WETH).deposit{ value: ethBalance }();
        for (uint256 index = 0; index < _pools.length; index++) {
            uint256 _allocation = _allocations[index];
            address _pool = _pools[index];
            IERC20(WETH).transfer(_pool, (ethBalance * _allocation) / 100);
            IPool(_pool).pairLiquidity();
        }
    }

    function executePhaseTwo() external onlyOwner duringPhase(Phases.One) {
        phase = Phases.Two;
        uint256 wethBalance = IERC20(WETH).balanceOf(address(this));
        IWETH(WETH).withdraw(wethBalance);
    }
}
