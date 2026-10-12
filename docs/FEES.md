# How the fee works

The rate is fixed at 10 basis points: `fee = floor(actual_lamports / 1000)`.

The Rust program takes a balance reading, invokes one allowlisted Pump or PumpSwap trade, takes another reading, then transfers the fee. It uses the actual difference, not the API's estimate. The transfer and swap happen inside one transaction.

- **Buy:** the fee is on actual SOL/WSOL spent, including the protocol's trading charges. The API reserves the maximum possible fee on the requested input budget. Cashback buys can spend less than their maximum; the service fee then falls too.
- **Sell:** the fee is on actual SOL/WSOL received after protocol charges. `minOut` is the gross minimum encoded in the trade. `minNetOut` is that minimum after our fee. Network fees and rent are not included in either figure.
- Network fees are deducted before instruction execution. ATA creation, SOL wrapping and Pump volume-account initialization happen outside the measured trade. Native-SOL trades reject account-size changes during the trade CPI to avoid charging on rent allocation or refunds.
- Fee amounts below one lamport round down to zero. There is no second, separate payment transaction.

The recipient is compiled into the program and builder:

`54pRN3VR97d6ELqu7uBeB5eu8nTKPnjPp2q2nJhb7CRv`

For PumpSwap, payment goes to this wallet's canonical SPL wrapped-SOL associated token account. The first caller may pay rent to create that account. Operators should initialize it before launch. The API never closes the recipient's account or unwraps the owner's funds. The owner can unwrap with a wallet that supports wrapped SOL.

Existing trader WSOL accounts are preserved. When a new trader WSOL account is created, it is closed after the trade and fee transfer, returning its remaining SOL and rent to the trader. For an existing account, unused prefunding and sell proceeds remain WSOL.

The fee program has no custody vault, deposit method or stored balances. The trader remains the only required transaction signer. Its public address is not a private key and cannot authorize spending by itself.

## Why a program is needed

A server cannot know the exact proceeds of a future sell. Adding a transfer calculated from a quote would not reliably charge 0.1% of the amount received. Measuring the balance inside a Solana program solves that timing problem.

The program also checks the curve's completion flag at execution. It rejects a curve instruction after graduation, and an AMM instruction before graduation. The underlying protocol validates the trading accounts and slippage bounds. This prevents the stale route from executing; it cannot turn every rejected transaction into a successful trade.

The implementation uses [Solana cross-program invocation](https://solana.com/docs/core/cpi) and [transaction atomicity](https://solana.com/docs/core/transactions/transaction-structure). Deployment and live-protocol verification remain required; host tests are not proof of mainnet compatibility.

## Business limits

The program always charges its fixed fee when it is used successfully. Someone can still call Pump directly, remove the wrapper from an unsigned transaction, or deploy modified source. MIT licensing permits forks. A public repository is a distribution channel, not an enforceable fee across all trades in the ecosystem.

This standalone edition has no marketplace subscription requirement. Its trading fee is collected inside a successfully executed transaction.
