# rift-contracts

These are Rift's V1 contracts and they consist of 2 separate products. The first product consists of the contracts in `Vault.sol` and `Pool.sol`. The second product consists of the contracts in `StableVault.sol` and `StableVaultToken.sol`.

## `Vault` and `Pool`

These contracts work together over a period of 3 phases, and users can only execute certain actions during each phase. The Vault contract is `Ownable`, inheriting the standard contract from OpenZeppelin. In V1, the Vault contract owner is assumed to be a benevolent party.

#### Phase Zero

Upon deployment, the `Vault` is in Phase Zero. Note that the `Pool`'s functionality is also restricted based on the current phase of the `Vault`.

The Vault deployer sets the `maxEth`, `feeTo`, and `feeAmount` state variables on deployment. `maxEth` is the total amount of `ETH` deposits that the Vault will accept. It can be modified by the contract owner during phase 1. `feeTo` is the address to which the protocol fee will be sent. `feeAmount` is the amount (out of 1000) that will be claimed as a protocol fee on profits from ETH depositors.

After deployment, the vault owner will be able to deploy new pools by calling `deployPool`. This creates a new `Pool` instance for a `token`. Each pool is deployed with a few important arguments:

- `token`: the token that can be deposited into this Pool.
- `pid`: this is the pool ID for the token's SushiSwap pool.
- `sushiRewarder`: indicator how this token's SushiSwap pool receives Sushi rewards. Can be `MasterChef`, `MasterChefV2`, or `None`.
- `fixedRate`: the fixed rate that will be paid to `token` depositors in this pool

The Vault doesn't allow new pools to be deployed for a token that already has a pool. However, in the case that a new pool must be deployed, the owner can override this check and deploy a new pool with the updated config.

During phase zero, users can deposit `ETH` or `WETH` into the Vault (using the `depositEth` or `depositWeth` functions), as long as their deposit doesn't cause the total amount of deposited `ETH` + `WETH` to be greater than `maxEth`. In return for their deposit, user receive an equivalent amount of the Vault's staking token. These deposits are not withdrawable until Phase Two.

The pool allows users to deposit the Pool's token into the contract while the Vault is in Phase Zero. For their deposit, users receive a 1:1 amount of the Pool's staking token. These deposits are not withdrawable until the vault is in Phase Two.

At the end of Phase Zero, the contract owner will call `nextPhase`. This prevents any more deposits.

#### Phase One

Now there is some amount of `ETH`/`WETH` sitting in the Vault contract, and some amount of tokens sitting in each Pool contract.

At the beginning of Phase One, the contract owner will wrap all `ETH` deposits into `WETH` by calling `wrapEth`. The Vault will then have X amount of `WETH` that is ready to be deployed.

The owner will now call `pairLiquidityPool` with the following arguments: the token to pair with, the amounts of `WETH` and `token` to deposit into the Sushi pool, and the minimum amounts of Weth and Token to deposit into SushiSwap (to prevent frontrunning). The Vault transfers that amount of `WETH` to the Pool for the relevant token, and calls `pairLiquidity` on that Pool. When `pairLiquidity` is called, the Pool then pairs the received `WETH` with the tokens that were deposited into the Pool during Phase Zero, and adds liquidity to the SushiSwap pool for the `WETH` / `token` pair. It receives the SLP staking tokens, and depending on the token, stakes them either into the `MasterChef`, `MasterChefV2`, or does nothing if the token is ineligible for sushi rewards. If the amount of `WETH` added to the SushiSwap pool is less than the initial amount sent by the Vault, the pool sends back any excess.

The Vault owner calls this `pairLiquidity` function on several pools. The deployed liquidity will stay in these pools for a period of time to generate a return from LP-ing.

At the end of the desired period, the Vault owner will unwind the liquidty that had been deployed by calling `unpairLiquidity` on each pool. The caller can set minimum amounts to receive from withdraw, to prevent frontrunning. Each pool responds by unwinding the staked SLP tokens from the `MasterChef` or `MasterChefV2` (or do nothing if not eligible), and converting the received `SUSHI` tokens into `WETH`. The Pool then withdraws its liquidity from the SushiSwap pool, and receives some amount of `WETH` and `token`. The Pool then calculates how much `token` is owed back to the Pool's depositors based on the Pool's fixed APY, the initial amount of `token` principal deposited into Sushiswap, and the timestamps of deposit and withdraw. If there is enough `token` received to pay back the fixed rate, the Pool swaps any remaining `token` for `WETH` and sends all the `WETH` back to the Vault. If there is not enough `token` to pay back the fixed rate, the Pool swaps as much `WETH` as is needed to pay back the owed amount of `token`. In extreme cases, there may not be enough `WETH` to pay back the owed `token`, and the Pool will swap all of its remaining `WETH` for `token`, and pay back as much `token` as is possible.

The Vault owner does this for each Pool that it deployed liquidity to at the beginning of this phase. After the Vault has recalled its liquidity from each Pool, the Vault owner will call `unwrapEth` to convert all `WETH` into `ETH`. The Vault contract now has some amount of `ETH`, and each pool has some amount of `token`.

The Vault owner then calls `nextPhase`, which moves the Vault into Phase Two.

#### Phase Two

During Phase Two, users can withdraw.

Users who deposited into the Vault can burn their staking tokens for their proportional share of `ETH` sitting in the vault contract by calling `withdrawEth`. They can also migrate their `ETH` to Rift's V2, by adding a valid argument for `_vaultV2`, and the vault sends their `ETH` to the new vault on behalf of the user.

Users who deposited into the Pool can burn their staking tokens for their proportional share of `token` sitting in the respective Pool by calling `withdrawToken`. Similarly, they can also migrate their liquidity to the V2 contracts by adding a valid argument for `_poolV2`.

## `StableVault` and `StableVaultToken`

The main contract is `StableVault`. This contract deploys and "owns" two instances of the `StableVaultToken`.

#### Deployment

After deployment, users are able to deposit `USDC` or `USDT`. Users are minted one of two staking tokens (a `StableVaultToken`), depending on which of the two tokens they deposited. The `StableVaultToken`s for `USDC` and `USDT` are owned by the `StableVault`, and new tokens can only be minted by the `StableVault` on a deposit or withdraw.

#### Adding liquidity

After sufficient deposits into the `StableVault`, the contract owner will call `addLiquidity`. This pairs the `USDC` and `USDT` currently in the `StableVault`, and adds liquidity to the Uniswap V2 Pair for these tokens. Users cannot deposit new tokens after this has function has been executed successfully. The caller can also specify minimum amounts of USDC and USDT to deposit into Uniswap, to prevent frontrunning. If the USDC and USDT deposits were imbalanced, the caller can also specify `_swapAmountIn`, `_swapAmountOutMin`, and `_swapUsdc`. This will swap `_swapAmountIn` for a minimum of `_swapAmountOutMin` using Uniswap V3. If `_swapUsdc` is true, the transaction swaps `USDC` -> `USDT`. If false, `USDT` -> `USDC`.

#### Removing Liquidity

After a period of time, the contract owner will call `removeLiquidity` on the `StableVault`. The Uniswap LP tokens are burned, and `USDC` and `USDT` are returned to the `StableVault`. Similarly to the `addLiquidity` function call, the owner can specify a swap of `USDC` for `USDT` or vice versa, to ensure that the amounts are rebalanced to their original ratios.

#### Withdraw

After liquidity has been removed from the `StableVault`, users can withdraw their proportional share of `USDC` or `USDT` by calling `withdrawToken`, which burns their staking tokens and either sends them their proportional share, or transfers their proportional share to the `StableVaultV2`, based on the user's preference.
