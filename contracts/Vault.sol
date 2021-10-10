// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.6;
import '@openzeppelin/contracts/access/Ownable.sol';
import '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import './interfaces/IPool.sol';
import './interfaces/IVaultV2.sol';
import './interfaces/IWETH.sol';

contract Vault is ERC20('RIFT - Fixed Rate ETH', 'riftETH'), Ownable {
    address public constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    uint256 public depositedEth;
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
        depositedEth += msg.value;
        require(depositedEth <= maxEth, 'Max eth cap has been hit');
        _mint(msg.sender, msg.value);
    }

    function depositWeth(uint256 _amount) external duringPhase(Phases.Zero) {
        depositedEth += _amount;
        require(depositedEth <= maxEth, 'Max eth cap has been hit');
        IWETH(WETH).transferFrom(msg.sender, address(this), _amount);
        _mint(msg.sender, _amount);
    }

    function withdrawEth(uint256 _amount) external duringPhase(Phases.Two) returns (uint256 returnAmount) {
        require(balanceOf(msg.sender) >= _amount, 'Withdraw amount exceeds balance');
        returnAmount = (address(this).balance * _amount) / totalSupply();
        _burn(msg.sender, _amount);
        payable(msg.sender).transfer(returnAmount);
    }

    function withdrawAndMigrate(address _vaultV2, uint256 _amount)
        external
        duringPhase(Phases.Two)
        returns (uint256 returnAmount)
    {
        require(balanceOf(msg.sender) >= _amount, 'Withdraw amount exceeds balance');
        returnAmount = (address(this).balance * _amount) / totalSupply();
        _burn(msg.sender, _amount);
        IVaultV2(_vaultV2).migrateLiquidity{ value: returnAmount }(msg.sender);
    }

    function ethShare(address _account) external view duringPhase(Phases.Two) returns (uint256 share) {
        uint256 stakingTokenBalance = balanceOf(_account);
        share = (address(this).balance * stakingTokenBalance) / totalSupply();
    }

    function pairLiquidityPool(address _pool, uint256 _amount) external onlyOwner {
        IWETH(WETH).transfer(_pool, _amount);
        IPool(_pool).pairLiquidity(_amount);
    }

    function unpairLiquidityPool(address _pool) external onlyOwner {
        IPool(_pool).unpairLiquidity();
    }

    function nextPhase() external onlyOwner {
        phase = Phases(uint256(phase) + 1);
    }

    function updateMaxEth(uint256 _maxEth) external onlyOwner duringPhase(Phases.Zero) {
        maxEth = _maxEth;
    }

    function wrapEth() external onlyOwner {
        uint256 ethBalance = address(this).balance;
        IWETH(WETH).deposit{ value: ethBalance }();
    }

    function unwrapEth() external onlyOwner {
        uint256 wethBalance = IWETH(WETH).balanceOf(address(this));
        IWETH(WETH).withdraw(wethBalance);
    }

    receive() external payable {
        assert(msg.sender == WETH);
    }
}
