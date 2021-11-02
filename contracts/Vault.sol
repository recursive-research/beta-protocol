// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.6;
import '@openzeppelin/contracts/access/Ownable.sol';
import '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import './interfaces/IPool.sol';
import './interfaces/IVaultV2.sol';
import './interfaces/IWETH.sol';

/// @title Rift V1 Eth Vault
/// @notice allows users to deposit eth, which will deployed to various pools to earn a return during a period.
contract Vault is ERC20('RIFT ETH Vault V1', 'riftETHv1'), Ownable {
    /// @notice weth9 address
    address public immutable WETH;

    mapping(address => address) public poolToToken;

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
        require(phase == _phase, 'Invalid Phase function');
        _;
    }

    /// @notice emitted after a successful deposit
    /// @param user the address that deposited into the Vault
    /// @param amount the amount that was deposited
    event Deposit(address indexed user, uint256 amount);

    /// @notice emitted after a successful migration
    /// @param vault the vault to which liquidity was migrated
    /// @param amount The amount of ETH that was migrated
    event Migration(address indexed vault, uint256 amount);

    /// @notice emitted after the vault pairs some of its liquidity with a pool
    /// @param pool the pool to which liquidity was deployed
    /// @param amount the amount of ETH that was deployed
    event LiquidityDeployed(address indexed pool, uint256 amount);

    /// @notice emitted after the vault unpairs its liquidity from a pool
    /// @param pool the pool from which liquidity was return
    event LiquidityReturned(address indexed pool);

    /// @notice creates a new vault.
    constructor(address _weth) {
        require(_weth != address(0), 'Invalid weth');
        WETH = _weth;
    }

    /// @notice allows users to deposit ETH during Phase zero and receive a staking token 1:1
    function depositEth() external payable duringPhase(Phases.Zero) {
        _mint(msg.sender, msg.value);
        emit Deposit(msg.sender, msg.value);
    }

    /// @notice allows users to deposit WETH during Phase zero and receive a staking token 1:1
    /// @param _amount the amount of WETH to deposit
    function depositWeth(uint256 _amount) external duringPhase(Phases.Zero) {
        _mint(msg.sender, _amount);
        emit Deposit(msg.sender, _amount);
        IWETH(WETH).transferFrom(msg.sender, address(this), _amount);
    }

    /// @notice allows the contract owner to migrate liquidity to the next version of contract
    /// @param _vaultV2 address of the next version of this contract. Trusted to be benevolent.
    /// This Vault's staking token will be be redeemable for an equivalent value of the VaultV2's
    /// staking token
    function migrateLiquidity(address _vaultV2) external onlyOwner duringPhase(Phases.Two) {
        uint256 balance = address(this).balance;
        emit Migration(_vaultV2, balance);

        IVaultV2(_vaultV2).migrateLiquidity{ value: balance }();
    }

    /// @notice registers a pool.
    /// @param _pool address of the pool being registered
    function registerPool(address _pool) external onlyOwner {
        require(_pool != address(0), 'Invalid pool');
        require(poolToToken[_pool] == address(0), 'Already registered');
        address token = IPool(_pool).token();
        poolToToken[_pool] = token;
    }

    /// @notice called by the contract owner during Phase One, sending WETH to a Pool and
    /// instructing the Pool to deploy the liquidity. Expected to be called on various pools.
    /// Min amounts should be set by the Owner to prevent frontrunning.
    /// @param _pool address of the pool to which liquidity is being deployed.
    /// if registered, already checked that != zero address
    /// @param _amountWeth amount of WETH to deploy to _pool
    /// @param _amountToken the desired amount of token to add as liquidity in the Pool
    /// @param _minAmountWeth the minimum amount of WETH to deposit
    /// @param _minAmountToken the minimum amount of token to deposit
    function pairLiquidityPool(
        address _pool,
        uint256 _amountWeth,
        uint256 _amountToken,
        uint256 _minAmountWeth,
        uint256 _minAmountToken
    ) external onlyOwner duringPhase(Phases.One) {
        require(poolToToken[_pool] != address(0), 'Invalid pool');
        IWETH(WETH).transfer(_pool, _amountWeth);
        uint256 wethDeployed = IPool(_pool).pairLiquidity(_amountWeth, _amountToken, _minAmountWeth, _minAmountToken);
        emit LiquidityDeployed(_pool, wethDeployed);
    }

    /// @notice called by the contract owner at the end of Phase One, unwinding the deployed liquidity
    /// and receiving WETH. Min amounts should be set by the Owner to prevent frontrunning.
    /// @param _pool the pool to remove liquidity from
    /// @param _minAmountWeth the minimum amount of WETH to deposit
    /// @param _minAmountToken the minimum amount of token to deposit
    function unpairLiquidityPool(
        address _pool,
        uint256 _minAmountWeth,
        uint256 _minAmountToken
    ) external onlyOwner duringPhase(Phases.One) {
        require(poolToToken[_pool] != address(0), 'Invalid pool');
        emit LiquidityReturned(_pool);
        IPool(_pool).unpairLiquidity(_minAmountWeth, _minAmountToken);
    }

    /// @notice allows the Vault owner to move the Vault into its next phase
    function nextPhase() external onlyOwner {
        uint256 _nextPhase = uint256(phase) + 1;
        require(_nextPhase <= 2, 'Invalid next phase');
        phase = Phases(_nextPhase);
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
