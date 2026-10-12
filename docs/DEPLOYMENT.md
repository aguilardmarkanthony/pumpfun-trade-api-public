# Run your own instance

This repository has two parts: a JavaScript API and a Rust program that runs on Solana. The API builds unsigned transactions. The program executes the trade and collects the exact 0.1% fee.

**Current status:** source preview. No fee-program deployment address has been configured. Do not point paying users at a fee-bearing endpoint until the program has been tested with the real protocol and its deployment has been verified. This API runs independently on your own endpoint.

## API configuration

| Setting | Purpose |
| --- | --- |
| `SOLANA_RPC_URL` | HTTPS RPC endpoint on the same cluster as the deployed router and token markets |
| `API_KEY` | Server API key; requests send `Authorization: Bearer YOUR_API_KEY` |
| `FEE_ROUTER_PROGRAM_ID` | Public address of your verified deployment of `programs/fee-router` |

Use ignored `.dev.vars` for local development. For Cloudflare, set secrets using `wrangler secret put` interactively. Do not put real credentials in shell history or repository files. The router ID is public configuration; it can be a Worker variable. The fee wallet is deliberately not a per-request or environment override.

`wrangler.jsonc` uses the name `pump-trade-router-preview`. Change it for your deployment. No account ID, credentials, live origin or production program ID is included here.

`/api/health` reports HTTP liveness only. It is not evidence that the RPC or program is available. `/api/capabilities` reports the configured program ID, not an audit or proof of successful execution.

## Build the program

For receiving-wallet setup, [examples/fee-wallet-setup.mjs](../examples/fee-wallet-setup.mjs) exports `buildFeeWalletSetup(connection)`. It reads current rent and network fees, reports missing funding, or returns an unsigned transaction that creates only the recipient's WSOL account. The recipient wallet must approve it locally. It does not wrap any SOL or deploy the fee program. If you do not fund/setup the recipient yet, keep this release in preview; no automatic debit occurs.

```js
import {Connection} from '@solana/web3.js';
import {buildFeeWalletSetup} from './examples/fee-wallet-setup.mjs';
const setup = await buildFeeWalletSetup(new Connection(process.env.SOLANA_RPC_URL, 'confirmed'));
// setup.ready === false: inspect additionalFundingLamports.
// setup.ready === true: inspect the unsigned transaction in the recipient wallet.
// setup.alreadyInitialized === true: no ATA creation is needed.
```

Host tests require Rust 1.89 or later. SBF compilation requires the Agave Solana build tools. CI uses the official Agave 4.3.0 Linux release with its published archive digest, and uploads only the `.so` artifact, never generated keypairs.

```sh
cargo test --manifest-path programs/fee-router/Cargo.toml --locked
cargo clippy --manifest-path programs/fee-router/Cargo.toml --locked --all-targets -- -D warnings
cargo build-sbf --manifest-path programs/fee-router/Cargo.toml
```

Building does not deploy a program or move funds. A program deployment needs its own program address, an owner-controlled deployment authority, and SOL for network fees and rent. Keep all deployment keypairs outside Git and outside the API process. **Never send a seed phrase or private key to the API or paste one into an issue.**

Before mainnet deployment, validate the SBF program in a local validator with matching Pump/PumpSwap programs and representative state. Devnet alone may not have matching protocol deployments or liquidity. Test both directions on each venue, cashback variants, first-use account setup, existing WSOL accounts, changed token stages, simulation errors, and transaction rollback.

After deployment:

1. Record the cluster, program ID, source commit, compiled artifact hash and upgrade authority.
2. Verify the deployed executable against the reviewed artifact and document whether its upgrade authority remains active. Do not silently change the fee policy via an upgrade.
3. Initialize/fund the native SOL recipient and its canonical wrapped-SOL account with the owner's approved wallet workflow. Native curve builds fail with `FEE_RECIPIENT_NOT_READY` while the recipient is absent or invalid. Precreating its WSOL account avoids passing setup rent to the first customer.
4. Set `FEE_ROUTER_PROGRAM_ID` and restart the API.
5. Use read-only simulation against real, current curve and PumpSwap state. Verify exact fee destinations and observed SOL/WSOL deltas.
6. Publish a release record distinguishing simulations from any owner-authorized live trades. Only then advertise an operational fee-bearing endpoint.

The API validates that the configured address is executable. This does not prove which code is deployed there. Operators must verify the binary and upgrade authority; clients must choose an endpoint/program they trust.

## Program interface

The wrapper forwards one allowlisted Pump/PumpSwap instruction. Its fixed account prefix is user, recipient wallet, curve, mint, measured SOL/WSOL account, fee destination, System Program, Token Program and trade program. Remaining accounts retain the SDK's exact order and per-instruction signer/writable flags.

Instruction bytes: version `1`, venue (`0` curve / `1` PumpSwap), action (`0` buy / `1` sell), trade-account count, one flags byte per trade account, then the original SDK instruction bytes. Flags use bit 0 for signer and bit 1 for writable.

On success, the program sets 24 bytes of return data: little-endian `u64` gross trade lamports, service fee, and total buy debit or net sell proceeds. Later instructions may replace return data; transaction accounting should also inspect balances and inner instructions.

| Custom error | Meaning |
| --- | --- |
| `6000` | Invalid accounts, recipient, instruction, signer, amount or required setup |
| `6001` | Curve stage changed; build a fresh route |
| `6002` | Unexpected balance change or breached amount bound |
| `6003` | Native trade changed account sizes; rent accounting cannot be trusted |

Underlying program errors propagate. A failed transaction rolls back account changes and the service fee; network fees can remain charged.

## Operational limits

Use a production RPC and hosting budget suited to expected traffic. The default public RPC is a development fallback, not a capacity guarantee. This preview allows at most eight concurrent builds per isolate, eight bounded RPC calls per request, and a 1232-byte v0 transaction. It has no lookup-table support, rate-limit billing system, managed signing, transaction broadcaster, indexer or latency SLA.
