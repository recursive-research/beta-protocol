# rift-contracts

These are the smart contracts for Rift V1. The most important contracts are in `Vault.sol` and `Pool.sol`.

These contracts work together over a period of 3 phases, and users can only execute certain actions during each phase. The Vault contract is `Ownable`, inheriting the standard `Ownable` contract from OpenZeppelin. In V1, the Vault contract owner is assumed to be a benevolent party.

### Phase Zero

Upon deployment, the `Vault` is in Phase Zero. Note that the `Pool`'s functionality is also restricted based on the current phase of the `Vault`.

The deployer sets the `fixedRate` and a `maxEth` state variables on deployment. The `fixedRate` is a number between 1 and 100, and is the APY that Vault depositors will receive at the end of the term. `maxEth` is the total amount of `ETH` deposits that the Vault will accept. It can be modified by the contract owner.

During phase zero, users can deposit `ETH` or `WETH` into the Vault (using the `depositEth` or `depositWeth` functions), as long as their deposit doesn't cause the total amount of deposited `ETH` + `WETH` to be greater than `maxEth`. In return for their deposit, user receive an equivalent amount of the Vault's staking token. These deposits are not withdrawable until Phase Two.

During this phase, users can also deposit into the Pool contract. Each pool is deployed with a few important arguments:

- `vault`: the address of the vault.
- `token`: the token that can be deposited into this Pool.
- `pid`: this is the pool ID for the token's SushiSwap pool.
- `sushiRewarder`: indicator how this token's SushiSwap pool receives Sushi rewards. Can be `MasterChef`, `MasterChefV2`, or `None`.

The pool allows users to deposit the Pool's token into the contract while the Vault is in Phase Zero. For their deposit, users receive a 1:1 amount of the Pool's staking token. These deposits are not withdrawable until the vault is in Phase Two.

At the end of Phase Zero, the contract owner will call `nextPhase`. This prevents any more deposits.

### Phase One

Now there is some amount of `ETH`/`WETH` sitting in the Vault contract, and some amount of tokens sitting in each Pool contract.

At the beginning of Phase One, the contract owner will wrap all `ETH` deposits into `WETH` by calling `wrapEth`. The Vault will then have X amount of `WETH` that is ready to be deployed. The owner will now call `pairLiquidityPool` with two arguments: the address of a pool, and an amount. The Vault transfers that amount of `WETH` to the Pool whose address was passed as an argument, and call `pairLiquidity` that Pool. When `pairLiquidity` is called, the Pool then pairs the received `WETH` with the tokens that were deposited into the Pool during Phase Zero, and adds liquidity to the SushiSwap pool for the `WETH` / `token` pair. It receives the SLP staking tokens, and depending on the token, stakes them either into the `MasterChef`, `MasterChefV2`, or does nothing if the token is ineligible for sushi rewards.

The Vault owner calls this `pairLiquidity` function on several pools. The deployed liquidity will stay in these pools for a period of time to generate a return from LP-ing.

At the end of this period, the Vault owner will unwind the liquidty that had been deployed by calling `unpairLiquidity` on each pool. Each pool responds by unwinding the staked SLP tokens from the `MasterChef` or `MasterChefV2` (or do nothing if not eligible), and converting the received `SUSHI` tokens into `WETH`. The Pool the withdraws its liquidity from the SushiSwap pool, and receives some amount of `WETH` and `token`. The Pool then calculates how much `WETH` is owed back to the Vault based on the Vault's fixed APY, the initial amount of `WETH` deposited, and the timestamps of deposit and withdraw. If there is enough `WETH` to pay back the fixed rate, the Pool transfer the owed `WETH` to the Vault, and swaps any remaining `WETH` for the `token`. If there is not enough `WETH` to pay back the fixed rate, the Pool swaps as much `token` as is needed to pay back the owed amount of `WETH`. In extreme cases, there may not be enough `token` to pay back the owed `WETH`, and the Pool will swap all of its remaining `token` for `WETH`, and pay back as much `WETH` as is possible. Once the `WETH` returned to the Vault, the pool swaps all remaining `WETH` to `token`.

The Vault owner does this for each Pool that it deployed liquidity to at the beginning of this phase. After the Vault has recalled its liquidity from each Pool, the Vault owner will call `unwrapEth` to convert all `WETH` into `ETH`. The Vault contract now has some amount of `ETH`, and each pool has some amount of `token`.

The Vault owner then calls `nextPhase`, which moves the Vault into Phase Two.

### Phase Two

During Phase Two, users can withdraw.

Users who deposited into the Vault can burn their staking tokens for their proportional share of `ETH` sitting in the vault contract by calling `withdrawEth`. They can also migrate their `ETH` to Rift's V2, by adding a valid argument for `_vaultV2`, and the vault sends their `ETH` to the new vault on behalf of the user.

Users who deposited into the Pool can burn their staking tokens for their proportional share of `token` sitting in the respective Pool by calling `withdrawToken`. Similarly, they can also migrate their liquidity to the V2 contracts by adding a valid argument for `_poolV2`.
