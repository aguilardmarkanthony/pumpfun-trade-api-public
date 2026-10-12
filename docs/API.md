# API reference

Pump Trade Router is a developer preview with a fixed 0.1% fee on actual SOL/WSOL trade value. A verified on-chain router deployment is required for transaction builds. This API runs on your own endpoint.

All routes except `/api/health` require `Authorization: Bearer YOUR_API_KEY`. Set `API_KEY` on your server and give it only to trusted clients. Send JSON with `Content-Type: application/json`. No marketplace account or subscription is required.

## Routes

| Method | Path | Result |
| --- | --- | --- |
| POST | `/api/quote` | Current curve or PumpSwap quote and fee estimate; no transaction |
| POST | `/api/trade/local` | Unsigned, simulated-by-default transaction with atomic fee wrapper |
| GET | `/api/curve/{mint}` | Curve completion, reserves and an indicative route; `poolValidated: false` |
| GET | `/api/capabilities` | Supported markets, limits, fee policy and configured program ID |
| GET | `/api/health` | API liveness and version; does not check RPC |

## Trade request

Required: `publicKey`, `mint`, `action` (`buy` or `sell`), and `amount`.

- Buy amount: SOL as a decimal string, at most nine decimals, maximum 100 SOL.
- Sell amount: raw token units as an integer string, up to unsigned 64-bit range.
- `pool`: `auto` by default; explicit `pump` or `pumpswap` must match current chain state.
- `slippageBps`: 1–5000, default 100. Legacy `slippage` is a percent; do not send both.
- `priorityFee`: total priority budget in integer lamports, 0–10,000,000, default 0. This is not a SOL amount or a service-fee override.
- `simulate`: boolean, default true for builds. Quotes do not run simulation. Keep this enabled for client integrations.
- Legacy `denominatedInSol` must agree with the action: true on buys, false on sells.

Unknown fields are rejected. Private keys, seeds, fee recipients and fee-rate overrides are not accepted. Maximum request body is 8192 bytes. The trader must be a normal system wallet, distinct from the fee recipient.

## Quote and build responses

Amounts are integer strings. `quotedOut`, `expectedOut` and `minOut` use raw token units for buys, lamports for sells. `contextSlot` labels the pricing snapshot. `quoteIsExecutionGuarantee` is false.

`serviceFeeBps` is 10. `feeRecipient` is `54pRN3VR97d6ELqu7uBeB5eu8nTKPnjPp2q2nJhb7CRv`. `feeAsset` is SOL on the curve and WSOL on PumpSwap. `estimatedServiceFeeLamports` is not final; the on-chain program measures execution balances. Buys include `maxServiceFeeLamports`. Sells include `expectedNetOut` and `minNetOut`, after our service fee. Network fees and rent are additional.

Cashback buys use `tradeMode: exact_output_with_max_input`; their expected token output is the encoded bounded output and actual SOL spend can be below the input cap. Other builds use `exact_input`. Protocol fees are reflected in quotes. Service-fee estimates are separate.

Builds add `transaction` (base64 unsigned v0), `requiredSigner`, `blockhash`, `lastValidBlockHeight`, `estimatedNetworkFeeLamports`, `instructionSummary` and `simulation`. They always report `unsigned: true` and `submitted: false`. The transaction's sole required signer is the requested wallet.

`simulation.status: passed` describes a read-only simulation without signature verification; it is not confirmation of a live trade. Errors or invalid simulation responses refuse the build. Keep the transaction fresh and inspect its program, fee recipient and amount bounds before wallet approval.

## Routing and supported markets

Incomplete Pump curves route to Pump. Completed curves require a validated canonical SOL-paired PumpSwap pool. The builder reads pricing and balances from one confirmed snapshot and rejects stage changes during discovery. The on-chain wrapper checks the curve stage again at execution.

Migration can leave a completed curve without a usable pool. This returns `MIGRATION_PENDING`. Buys near completion return `GRADUATION_BOUNDARY`; they do not silently use partial fills. Raydium, non-SOL quotes, custom AMM pools, frozen mints and unsupported token extensions are rejected.

Existing trader WSOL accounts remain open, with WSOL sell proceeds. Newly created WSOL accounts are closed after fee collection. The recipient's WSOL account remains open. Account rent is paid by the trader when setup is needed and is excluded from the service-fee base.

## Error handling

Errors have `{ "error": { "code": "...", "message": "..." }, "requestId": "..." }`. Invalid input uses 400; authentication 401; missing markets 404; venue/migration changes 409; invalid or unsupported trades 422; unavailable RPC/router or stale state 503.

See [usage examples](USAGE.md) for common fixes and [deployment](DEPLOYMENT.md) for router errors. Do not blindly submit a second transaction when the first transaction's status is unknown.
