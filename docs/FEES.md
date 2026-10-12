# How the trading fee works

The default Jupiter mode includes a fixed **25 basis points (0.25%)** platform fee. The recipient is `54pRN3VR97d6ELqu7uBeB5eu8nTKPnjPp2q2nJhb7CRv`. Its associated wrapped-SOL account is `Qw1PedkKHGm885bGJvcZNF56yCzDhNjJNUR8eD9BvWz`.

## Buys

The fee is included in the requested SOL budget. For `amount: "1"`, the fee is 0.0025 SOL and 0.9975 SOL is available to the swap, including the protocol's own trading costs. Network fees and account rent are additional. Partial curve fills are disabled so an incomplete fill cannot be charged against the larger requested amount.

## Sells

The fee is calculated on actual SOL proceeds after protocol trading fees, then deducted from those proceeds. If the swap produces 1 SOL before our fee, the service receives 0.0025 WSOL and the trader receives 0.9975 SOL/WSOL. Integer fees round down; a fee under one lamport is zero.

For both directions, Jupiter's deployed program performs the swap and fee transfer atomically. The API checks the encoded fee rate and recipient, then checks the exact fee transfer and swap event in unsigned simulation. Simulation describes a possible execution, not a receipt for a paid fee. Quotes, builds, downloads and failed transactions do not earn commissions.

## Receiving-account setup

The operator does **not** need to deposit 0.005 SOL or manually approve fee collection. If the recipient's wrapped-SOL account is missing, the builder includes its idempotent creation, paid by the trader. The same transaction either creates the account, trades and pays the fee, or rolls those changes back.

The response discloses `feeAccountSetupRequired`, `feeAccountSetupPaidBy: "trader"` and, on builds, `feeAccountSetupRentLamports`. A read-only mainnet simulation on October 13, 2026 measured **1,488,440 lamports (0.00148844 SOL)**. Rent is queried through the actual simulation and can change. Clients should show the extra cost before signing, especially for small trades. Once the account exists, this creation charge is zero. If its owner closes it, a later trader may need to create it again.

That rent funds an account controlled by the fee recipient; it is separate from the 0.25% commission. User token accounts and protocol accounts can require additional rent, which is not included in that one field. The operator can choose to create the receiving account beforehand to spare the first trader this cost, but that is optional.

## Access and control

Public API access needs no signup or key. Your wallet owns the received WSOL and can unwrap it when you want native SOL. Routine collection needs no operator signature. A customer must still authorize their own trades; a bot may automate signing locally. The API never accepts wallet secrets or signs/submits transactions.

Jupiter documents no additional swap fee on the `/build` route used here. [Jupiter build documentation](https://developers.jup.ag/docs/swap/build). Network fees, Pump/PumpSwap protocol charges and account rent remain separate. MIT forks can remove or change the configured fee; public source does not force every fork to pay this wallet.

The optional custom Rust router uses a different mechanism and fee basis: an extra fee on measured CPI spend/proceeds, native SOL for curve trades and WSOL for AMM trades. It remains experimental and undeployed; it is not the default service.
