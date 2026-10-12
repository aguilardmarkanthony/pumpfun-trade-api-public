# Use the API

## 1. Pick the token and amount

Use a Solana token's **mint address**, not its ticker. Send your public wallet address, never your seed phrase or private key.

Buy with 0.01 SOL:

```json
{
  "publicKey": "YOUR_PUBLIC_WALLET",
  "mint": "TOKEN_MINT",
  "action": "buy",
  "amount": "0.01",
  "pool": "auto",
  "slippageBps": 100,
  "simulate": true
}
```

Sell one token with six decimals:

```json
{
  "publicKey": "YOUR_PUBLIC_WALLET",
  "mint": "TOKEN_MINT",
  "action": "sell",
  "amount": "1000000",
  "pool": "auto",
  "slippageBps": 100,
  "simulate": true
}
```

Keep amounts in strings so JavaScript does not round large integers. `slippageBps: 100` means 1%. It limits price movement; it is not the 0.1% service fee. Sell amounts use the token's actual decimals, which may differ from this example.

## 2. Ask for a quote

```js
import { quoteTrade } from './examples/client.mjs';

const settings = {
  baseUrl: 'http://localhost:8787',
  apiSecret: process.env.API_SECRET
};
const order = {
  publicKey: process.env.WALLET_ADDRESS,
  mint: process.env.TOKEN_MINT,
  action: 'buy',
  amount: '0.01',
  pool: 'auto',
  slippageBps: 100
};

const quote = await quoteTrade(settings, order);
console.log(quote.venue, quote.estimatedServiceFeeLamports, quote.feeAsset);
```

`venue: "pump"` means the bonding curve. `venue: "pumpswap"` means a graduated canonical pool. The API checks the chain; you do not maintain a token-stage list.

## 3. Build an unsigned transaction

This step requires a deployed, configured and verified fee program.

```js
import { buildTrade } from './examples/client.mjs';

const { response, transaction } = await buildTrade({
  ...settings,
  expectedRouterProgramId: process.env.FEE_ROUTER_PROGRAM_ID
}, order);

console.log(response.venue, response.simulation.status);
// `transaction` is a VersionedTransaction for your wallet integration.
// Review it and ask the user to approve it through their wallet.
// This example does not sign or submit an order.
```

The client performs basic signer, wrapper and recipient checks. These are not a full independent transaction audit. Use an endpoint and deployed program you trust, and inspect every instruction before wallet approval. Keep your server's proxy secret on the server; do not put it in a public browser bundle.

## 4. Let the wallet handle execution

Your application asks the wallet to sign locally, submits through its RPC, and monitors the resulting signature. Use `blockhash` and `lastValidBlockHeight` to handle expiration. A returned signature alone is not confirmation of a successful trade.

Build close to signing time. After a confirmed failure or an expired transaction, fetch fresh state and build again. If submission status is unknown, check the original signature first; blindly building another order can produce duplicate trades.

## Reading the result

| Field | Meaning |
| --- | --- |
| `expectedOut` | Estimated token units for buys, or gross SOL/WSOL lamports for sells |
| `minOut` | Minimum output encoded in the underlying trade |
| `minNetOut` | Sell minimum after the 0.1% service fee |
| `estimatedServiceFeeLamports` | An estimate; the program uses the execution balance change |
| `maxServiceFeeLamports` | Buy fee ceiling based on the input budget |
| `feeAsset` | SOL on the curve; WSOL on PumpSwap |
| `outputAsset` | Token on buys; SOL or WSOL on sells |
| `simulation.status` | `passed` or `not_run`; simulation is enabled by default |
| `submitted` | Always `false`; the API never broadcasts |

1 SOL equals 1,000,000,000 lamports. Network fees and account rent are additional.

## Common errors

| Code | What to do |
| --- | --- |
| `FEE_ROUTER_NOT_DEPLOYED` | The operator must deploy/configure the fee program. Quotes alone do not collect fees. |
| `FEE_RECIPIENT_NOT_READY` | The operator must initialize the native SOL recipient wallet. |
| `VENUE_CHANGED` | Build again with `pool: "auto"`. |
| `MIGRATION_PENDING` | Wait for the canonical PumpSwap pool, then request a fresh build. |
| `GRADUATION_BOUNDARY` | Reduce the buy size or rebuild after migration. |
| `SIMULATION_FAILED` | Check token balance, SOL for fees/rent, and current token support. Fetch fresh state. |
| `INSUFFICIENT_SOL_BALANCE` | Fund the wallet for input, maximum service fee, network fees and possible rent. |
| `TRANSACTION_TOO_LARGE` | This route exceeds the supported 1232-byte v0 packet. This preview does not use lookup tables. |
| `STALE_STATE` | Rebuild with current RPC data. |

The on-chain router's custom errors are documented in [deployment notes](DEPLOYMENT.md). SOL pairs and canonical PumpSwap pools only. Raydium, non-SOL pairs and arbitrary AMM pools are unsupported.
