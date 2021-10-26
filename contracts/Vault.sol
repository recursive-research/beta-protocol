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
    /// @notice weth9 address
    address public immutable WETH;
    /// @notice feeTo address for protocol fee
    address public feeTo;
    /// @notice fee out of 1000 on profits
    uint256 public feeAmount;

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

    /// @notice emitted after a successful withdrawal
    /// @param user the address that withdrew from the Vault
    /// @param amount The amount of ETH that was withdrawn
    event Withdraw(address indexed user, uint256 amount);

    /// @notice emitted after a successful migration
    /// @param user the address that migrated from the Vault
    /// @param amount The amount of ETH that was migrated
    event Migration(address indexed user, uint256 amount);

    /// @notice emitted after the vault pairs some of its liquidity with a pool
    /// @param pool the pool to which liquidity was deployed
    /// @param amount the amount of ETH that was deployed
    event LiquidityDeployed(address indexed pool, uint256 amount);

    /// @notice emitted after the vault unpairs its liquidity from a pool
    /// @param pool the pool from which liquidity was return
    event LiquidityReturned(address indexed pool);

    /// @notice creates a new vault.
    constructor(
        address _feeTo,
        uint256 _feeAmount,
        address _weth
    ) {
        require(_feeAmount <= 100, 'Invalid feeAmount'); // maximum 10%
        require(_weth != address(0), 'Invalid weth');
        feeTo = _feeTo;
        feeAmount = _feeAmount;
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

    /// @notice allows users to burn their staking tokens and withdraw ETH during Phase Two.
    /// Users can only withdraw or migrate their entire balance. There will be no reason to
    /// keep their ETH in the Vault after phase two. So they can employ it productively by
    /// either migrating it to a V2 vault, or by withdrawing the full amount.
    /// @param _vaultV2 if the user wishes to migrate their liquidity to Rift's V2 Vault,
    /// they can do so by setting an address that is the Rift V2 vault, and the contract will
    /// send their ETH to the new Vault on behalf of the user. Otherwise, the contract sends
    /// the user's proportional share of ETH back to the user.
    function withdrawEth(address _vaultV2) external duringPhase(Phases.Two) returns (uint256 returnAmount) {
        uint256 amount = balanceOf(msg.sender);
        require(amount > 0, 'User has no balance');
        returnAmount = (address(this).balance * amount) / totalSupply();
        // if feeAmount > 0 and feeTo is set and the position was profitable
        if (feeAmount != 0 && feeTo != address(0) && returnAmount > amount) {
            uint256 protocolFee = ((returnAmount - amount) * feeAmount) / 1000;
            returnAmount -= protocolFee;
            IWETH(WETH).deposit{ value: protocolFee }();
            IWETH(WETH).transfer(feeTo, protocolFee);
        }
        _burn(msg.sender, amount);
        if (_vaultV2 == address(0)) {
            emit Withdraw(msg.sender, returnAmount);
            payable(msg.sender).transfer(returnAmount);
        } else {
            emit Migration(msg.sender, returnAmount);
            IVaultV2(_vaultV2).migrateLiquidity{ value: returnAmount }(msg.sender);
        }
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
        IPool(_pool).unpairLiquidity(_minAmountWeth, _minAmountToken);
        emit LiquidityReturned(_pool);
    }

    /// @notice allows the Vault owner to move the Vault into its next phase
    function nextPhase() external onlyOwner {
        uint256 _nextPhase = uint256(phase) + 1;
        require(_nextPhase <= 2, 'Invalid next phase');
        phase = Phases(_nextPhase);
    }

    /// @notice set the fee to address
    function setFeeTo(address _feeTo) external onlyOwner {
        feeTo = _feeTo;
    }

    /// @notice set the fee amount
    function setFeeAmount(uint256 _feeAmount) external onlyOwner {
        require(_feeAmount <= 100, 'Invalid feeAmount'); // maximum 10%
        feeAmount = _feeAmount;
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
