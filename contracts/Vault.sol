// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.6;
import '@openzeppelin/contracts/access/Ownable.sol';
import '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import './interfaces/IPool.sol';
import './interfaces/IVaultV2.sol';
import './interfaces/IWETH.sol';

/// @title Rift V1 Eth Vault
/// @notice allows users to deposit eth, which will deployed to various pools to earn a return during a period.
contract Vault is ERC20('RIFT - Fixed Rate ETH V1', 'riftETHv1'), Ownable {
    address public constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    uint256 public depositedEth;
    /// @notice the fixed rate that Pools are required to return to the Vault at the end of the period.
    uint256 public fixedRate;
    /// @notice the maximum amount of ETH that can be deposited into the contract during Phase Zero.
    /// Modifiable by owner.
    uint256 public maxEth;

    /// @notice the Vault has 3 Phases, and actions are restricted based on which Phase it's in.
    enum Phases {
        Zero,
        One,
        Two
    }

    /// @notice indicator which Phase the Vault is in. The owner can move the Vault to the next Phase.
    Phases public phase = Phases.Zero;

    /// @notice restricts actions based on the current Phase.
    modifier duringPhase(Phases _phase) {
        require(phase == _phase, 'Cannot execute this function during current phase');
        _;
    }

    /// @notice creates a new vault.
    /// @param _fixedRate numerator for the fixed rate that will be returned from Pools.
    /// @param _maxEth sets the maximum amount of ETH or WETH that can be deposited.
    constructor(uint256 _fixedRate, uint256 _maxEth) {
        fixedRate = _fixedRate;
        maxEth = _maxEth;
    }

    /// @notice allows users to deposit ETH during Phase zero and receive a staking token 1:1
    function depositEth() external payable duringPhase(Phases.Zero) {
        depositedEth += msg.value;
        require(depositedEth <= maxEth, 'Max eth cap has been hit');
        _mint(msg.sender, msg.value);
    }

    /// @notice allows users to deposit WETH during Phase zero and receive a staking token 1:1
    function depositWeth(uint256 _amount) external duringPhase(Phases.Zero) {
        depositedEth += _amount;
        require(depositedEth <= maxEth, 'Max eth cap has been hit');
        IWETH(WETH).transferFrom(msg.sender, address(this), _amount);
        _mint(msg.sender, _amount);
    }

    /// @notice allows users to burn their staking tokens and withdraw ETH during Phase Two
    /// @param _amount the amount of staking tokens the user wishes to burn
    /// @param _vaultV2 if the user wishes to migrate their liquidity to Rift's V2 Vault,
    /// they can do so by setting an address that is the Rift V2 vault, and the contract will
    /// send their ETH to the new Vault on behalf of the user. Otherwise, the contract sends
    /// the user's proportional share of ETH back to the user.
    function withdrawEth(uint256 _amount, address _vaultV2)
        external
        duringPhase(Phases.Two)
        returns (uint256 returnAmount)
    {
        require(balanceOf(msg.sender) >= _amount, 'Withdraw amount exceeds balance');
        returnAmount = (address(this).balance * _amount) / totalSupply();
        _burn(msg.sender, _amount);
        if (_vaultV2 == address(0)) {
            payable(msg.sender).transfer(returnAmount);
        } else {
            IVaultV2(_vaultV2).migrateLiquidity{ value: returnAmount }(msg.sender);
        }
    }

    /// @notice helper function for the frontend to view a user's proportional share of ETH
    /// during Phase Two
    /// @param _account the account of the user whose share is being requested
    function ethShare(address _account) external view duringPhase(Phases.Two) returns (uint256 share) {
        uint256 stakingTokenBalance = balanceOf(_account);
        share = (address(this).balance * stakingTokenBalance) / totalSupply();
    }

    /// @notice called by the contract owner during Phase One, sending WETH to a Pool and
    /// instructing the Pool to deploy the liquidity. Expected to be called on various pools.
    /// @param _pool address of the pool to which liquidity is being deployed
    /// @param _amount amount of WETH to deploy to _pool
    function pairLiquidityPool(address _pool, uint256 _amount) external onlyOwner {
        IWETH(WETH).transfer(_pool, _amount);
        IPool(_pool).pairLiquidity(_amount);
    }

    /// @notice called by the contract owner at the end of Phase One, unwinding the deployed liquidity
    /// and receiving WETH.
    /// @param _pool address of the pool to unwind liquidity from
    function unpairLiquidityPool(address _pool) external onlyOwner {
        IPool(_pool).unpairLiquidity();
    }

    /// @notice allows the Vault owner to move the Vault into its next phase
    function nextPhase() external onlyOwner {
        phase = Phases(uint256(phase) + 1);
    }

    /// @notice allows the owner to update the maximum amount of ETH/WETH depositable
    /// Only relevant during phase zero, because deposits are not allowed during Phases 1 or 2
    function updateMaxEth(uint256 _maxEth) external onlyOwner duringPhase(Phases.Zero) {
        maxEth = _maxEth;
    }

    /// @notice allows the owner to wrap any ETH in the contract. Called at the beginning of Phase One
    /// so that the Vault can deploy WETH to various pools.
    function wrapEth() external onlyOwner {
        uint256 ethBalance = address(this).balance;
        IWETH(WETH).deposit{ value: ethBalance }();
    }

    /// @notice allows the owner to unwrap WETH into ETH. Called at the end of Phase One, after liquidity
    /// has been unpaired from each of the Pools.
    function unwrapEth() external onlyOwner {
        uint256 wethBalance = IWETH(WETH).balanceOf(address(this));
        IWETH(WETH).withdraw(wethBalance);
    }

    /// @notice allows the Vault to receive ETH on withdraws from the WETH contract.
    receive() external payable {
        assert(msg.sender == WETH);
    }
}
