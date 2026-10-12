# Use the API

Public mode has no signup, subscription or API key. The operator does not approve customer trades. Your wallet or bot signs the returned transaction locally; the API never receives your private key.

## Buy

Send a POST request to `/api/trade/local` with `Content-Type: application/json`:

```json
{"publicKey":"YOUR_PUBLIC_WALLET","mint":"TOKEN_MINT","action":"buy","amount":"0.01","pool":"auto","slippageBps":100,"simulate":true}
```

Use a mint address, not a ticker. This spends up to the 0.01 SOL input budget, including our 0.1% service fee, plus network fees and any necessary account rent. `slippageBps: 100` means 1%. The service requires successful unsigned simulation before returning a build.

## Sell

```json
{"publicKey":"YOUR_PUBLIC_WALLET","mint":"TOKEN_MINT","action":"sell","amount":"1000000","pool":"auto","slippageBps":100,"simulate":true}
```

Sell amounts are raw token units. A six-decimal token has 1,000,000 units per token. Use decimal strings to avoid rounding errors. `minOut` and `expectedOut` are already net of the service fee in Jupiter mode; don't subtract it a second time.

Use `/api/quote` with the same body for a quote without a transaction or simulation. Quotes can work without enough wallet funds; builds cannot.

## JavaScript

From this repository:

```js
import {buildTrade, quoteTrade} from './examples/client.mjs';

const settings = {
  baseUrl: 'http://localhost:8787', // Replace with the deployed endpoint.
  rpcUrl: process.env.SOLANA_RPC_URL // Used to resolve transaction lookup tables.
};
const order = {
  publicKey: 'YOUR_PUBLIC_WALLET',
  mint: 'TOKEN_MINT',
  action: 'buy',
  amount: '0.01',
  pool: 'auto',
  slippageBps: 100
};

const quote = await quoteTrade(settings, order);
console.log(quote.venue, quote.expectedOut, quote.estimatedServiceFeeLamports);

const {response, transaction} = await buildTrade(settings, order);
console.log('Fee recipient:', response.feeRecipient);
console.log('Fee account setup rent:', response.feeAccountSetupRentLamports);
console.log('Unsigned transaction:', response.transaction);
// Pass transaction to your own wallet integration after reviewing costs.
// This example does not sign or broadcast a transaction.
```

For a private self-hosted server only, add `apiKey: process.env.API_KEY`. The public service does not require that setting. Never place infrastructure credentials in a public browser bundle.

The sample checks the signer, fee destination, encoded rate, amount, slippage and supported router instruction. It resolves lookup tables from chain. These are basic checks, not a complete independent audit of every instruction. Use a trusted endpoint and inspect the whole transaction before approving it.

## Read the response

| Field | Meaning |
| --- | --- |
| `venue` | `pump` for the curve, `pumpswap` for the canonical graduated pool. |
| `transaction` | Base64 unsigned v0 transaction, ready for your wallet integration. |
| `lastValidBlockHeight` | Expiry bound. Rebuild if it expires; don't keep retrying stale bytes. |
| `expectedOut` / `minOut` | Estimated output / minimum output after service fees, in raw units. |
| `simulation.serviceFeeLamports` | Fee observed in this unsigned simulation, not an earned-fee receipt. |
| `feeAccountSetupRequired` | First use may require the trader to fund the service's WSOL account. |
| `feeAccountSetupRentLamports` | That account's rent in this simulation; other account rent can be additional. |
| `outputAsset` | Existing WSOL accounts stay open, so sell proceeds can remain WSOL. |

Show first-use rent before asking a user to sign. The receiving account currently needs roughly 0.00149 SOL, which can exceed the fee on a small trade. See [Fees](FEES.md).

## Common errors

| Code | What to do |
| --- | --- |
| `VENUE_CHANGED` | Request a fresh build with `pool: "auto"`. |
| `MIGRATION_PENDING` | Wait for the canonical pool to become available. |
| `GRADUATION_BOUNDARY` | Use a smaller buy or wait for graduation. |
| `SIMULATION_FAILED` | Check wallet balances, rent, liquidity and stage, then rebuild. |
| `ROUTE_UNAVAILABLE` | Retry later; the upstream may not have indexed this token yet. |
| `ROUTE_REJECTED` | The returned route failed safety checks; no transaction is returned. |
| `RATE_LIMITED` | Honor `Retry-After` and back off. |

No build guarantees execution. A token can graduate after the response, and prices or balances can change before a transaction lands. Rebuild after a stage change; never retry indefinitely.
