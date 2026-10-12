# Pump Trade Router

Buy and sell Pump tokens without guessing which market they use.

[![Checks](https://github.com/aguilardmarkanthony/pumpfun-trade-api-public/actions/workflows/ci.yml/badge.svg)](https://github.com/aguilardmarkanthony/pumpfun-trade-api-public/actions/workflows/ci.yml)

Give the API a token mint, your public wallet address and an amount. It reads the token's on-chain state, selects the bonding curve or canonical PumpSwap pool, and builds a transaction for your wallet to sign.

**Status: developer preview.** The API and fee-program source are available here. The fee program has not been deployed or verified against live Pump trades. Quotes work with an RPC connection; transaction builds stay disabled until an operator deploys and configures the program. This repository does not activate fees on the existing RapidAPI service.

## What you get

- Automatic curve/PumpSwap selection, checked again by the fee program at execution.
- A disclosed **0.1% fee**, calculated from the actual SOL spent or received by the trade.
- Unsigned transactions, simulation, slippage limits and clear migration errors.
- Existing wrapped-SOL accounts stay open. No private keys are accepted by the API.

If a coin is moving between markets, the API asks you to rebuild. It does not guess a route. Prices, balances and network conditions can still cause a transaction to fail.

## Try a quote

You need Node.js 22 or 24 and a Solana mainnet RPC URL.

```sh
git clone https://github.com/aguilardmarkanthony/pumpfun-trade-api-public.git
cd pumpfun-trade-api-public
npm ci --ignore-scripts
```

Create `.dev.vars` in the project folder. Use your own values; keep this file private.

```ini
SOLANA_RPC_URL="https://YOUR_SOLANA_RPC"
RAPIDAPI_PROXY_SECRET="YOUR_LOCAL_API_PASSWORD"
```

Then run:

```sh
npm run dev
```

Edit [examples/buy.json](examples/buy.json): replace the sample wallet and mint with your own public wallet and the token you want to inspect. The example asks to buy with **0.01 SOL**.

```sh
curl http://localhost:8787/api/quote \
  -H "Content-Type: application/json" \
  -H "X-RapidAPI-Proxy-Secret: YOUR_LOCAL_API_PASSWORD" \
  --data-binary @examples/buy.json
```

On Windows PowerShell, use `curl.exe` and put the command on one line.

The useful response fields are `venue`, `expectedOut`, `minOut`, `estimatedServiceFeeLamports` and `feeAsset`. A quote does not place an order or collect a fee.

## Build a buy or sell

After the fee program is deployed, add its public address as `FEE_ROUTER_PROGRAM_ID` in `.dev.vars` and restart the API. Change `/api/quote` above to `/api/trade/local`. You will receive an unsigned base64 transaction; your own wallet handles approval, signing and submission.

For a sell, use [examples/sell.json](examples/sell.json). Sell amounts are **raw token units**, not SOL. For a token with six decimals, `"1000000"` means one token.

For JavaScript, start with [examples/client.mjs](examples/client.mjs). It includes `quoteTrade()` and `buildTrade()` and does not sign or submit anything. [The walkthrough](docs/USAGE.md) explains the response and common errors.

## Where the fee goes

Recipient: **`54pRN3VR97d6ELqu7uBeB5eu8nTKPnjPp2q2nJhb7CRv`**

| Trade | Fee basis | Received by the fee wallet |
| --- | --- | --- |
| Curve buy | Actual SOL spent by the trade | SOL |
| Curve sell | Actual SOL proceeds after protocol fees | SOL |
| PumpSwap buy | Actual wrapped SOL spent by the trade | Wrapped SOL |
| PumpSwap sell | Actual wrapped SOL proceeds after protocol fees | Wrapped SOL |

At 1 SOL of trade value, the service fee is 0.001 SOL. Wrapped SOL represents SOL 1:1 and can be unwrapped by its owner. Fees round down to the nearest lamport. Network fees, protocol fees and account rent are separate.

The trade and service fee are atomic: if either fails, both roll back. Solana can still charge network fees for a failed transaction. [Fee details](docs/FEES.md).

## For maintainers

[Deployment](docs/DEPLOYMENT.md) · [API reference](docs/rapidapi.md) · [OpenAPI](docs/openapi.json) · [Review and test limits](docs/REVIEW.md) · [Security](SECURITY.md)

```sh
npm test
npm run check
npm run build:check
npm audit --audit-level=moderate
cargo test --manifest-path programs/fee-router/Cargo.toml --locked
```

MIT licensed. Developers may fork and change the code, including its fee. Revenue comes from integrations that use this fee-bearing program; public source cannot force every fork to pay the original recipient. Pump.fun and Solana names describe compatibility, not affiliation.
