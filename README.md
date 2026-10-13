# Pumpfun Buy and Sell API - Pump Trade Router

**Customer RPC mode:** run this API or import its client inside your own bot. All application blockchain RPC work uses your endpoint. Start with [the customer RPC guide](docs/CUSTOMER-RPC.md). The public site serves documentation; hosted trade/quote/market endpoints are retired in this release. Existing funded-test and settlement requirements remain.

An independent Pump.fun (Pumpfun) buy and sell API for Solana. Build trades for bonding-curve tokens and graduated PumpSwap tokens without guessing which market they use.

[![Checks](https://github.com/apilabph/pumpfun-trade-api-public/actions/workflows/ci.yml/badge.svg)](https://github.com/apilabph/pumpfun-trade-api-public/actions/workflows/ci.yml)

Give the API a token mint, your public wallet address and an amount. It checks the token's on-chain stage, selects the bonding curve or canonical PumpSwap pool, and returns a simulated, unsigned transaction. Your wallet or bot signs and submits it.

**Standalone public beta.** No marketplace subscription, signup or APILabPH API key is required. Run preparation locally with your own RPC and any required Jupiter routing credential. The API uses Jupiter's existing on-chain router; you do not deploy a custom Solana program. This repository contains both the API and the client examples.

Pump Trade Router is maintained by API Lab PH and is not an official Pump.fun or PumpSwap product.

[Read the public quickstart](https://pump-trade-router.apilabph.workers.dev/) for the customer RPC guide, buying and selling, routing behavior and fees.

## What it does

- Detects curve versus graduated tokens from chain state and checks again before returning a build.
- Restricts trades to one verified Pump or canonical PumpSwap market.
- Includes a transparent **0.25% service fee** in the same transaction as the trade.
- Simulates every build, verifies the simulated fee transfer and refuses unsupported or changed routes.
- Preserves existing wrapped-SOL accounts. Never asks for private keys.

## Why use this API?

Built for wallet and bot developers who want to review a trade before signing:

- **A readable trade response:** selected market, minimum received, simulated fee, setup rent, signer and expiry alongside the transaction.
- **A fee ceiling you control:** send `maxServiceFeeBps: 25` to reject a service charge above 0.25%. A lower limit returns an error before any upstream work.
- **Checks you can inspect:** public source, tests and a JavaScript example that checks the encoded fee, amounts, slippage and recipient locally.
- **Fewer network calls:** fee accounts and pricing share one confirmed account read. Every build still runs simulation and rechecks the token's stage.

The 0.25% service fee matches PumpApi's published trading rate and is half PumpPortal Local's published 0.5%. Both also offer local signing and automatic routing. See the [documented comparison and limitations](docs/COMPARISON.md); we do not claim to be the fastest or support every market.

Migration, price changes, blockhash expiry and network conditions can still cause a transaction to fail. If the venue changes, rebuild with `pool: "auto"`; an already signed transaction cannot switch venues by itself.

## First request

First follow [customer RPC setup](docs/CUSTOMER-RPC.md). Run `npm run api:local`; the example below targets your local API, not the documentation host.

```sh
curl http://127.0.0.1:8787/api/quote \
  -H "Content-Type: application/json" \
  --data '{"publicKey":"YOUR_PUBLIC_WALLET","mint":"TOKEN_MINT","action":"buy","amount":"0.01","pool":"auto","slippageBps":100,"maxServiceFeeBps":25}'
```

Replace both addresses. On Windows PowerShell, use `curl.exe` and put the command on one line. A quote does not trade or collect a fee.

Change `/api/quote` to `/api/trade/local` to receive an unsigned base64 transaction. For a sell, use `"action":"sell"` and a raw token amount: `"1000000"` means one token with six decimals.

[Step-by-step usage and JavaScript](docs/USAGE.md) - [API reference](docs/API.md) - [OpenAPI](docs/openapi.json) - [Transaction speed](docs/PERFORMANCE.md)

## Automate it in your bot

Use [`executeTrade()`](docs/BOT-EXECUTION.md) to build, inspect, sign locally, submit and track a trade in one JavaScript call. Your bot keeps its keys. A persistent trade ID prevents the helper from creating another trade when a submission reply is lost. The guide includes buy/sell examples, cost limits and restart recovery. This is local bot execution; the local API returns unsigned transactions.

## Trading costs

Successful trades include a **0.25% service fee**, paid in wrapped SOL: included in the requested SOL budget for buys, or deducted from actual SOL proceeds for sells. Network fees, protocol fees and account rent are separate.

If the service's receiving account is missing, the first trader pays its setup rent; the build reports this separately before signing. See [fee details, examples and the recipient address](docs/FEES.md).

**Upgrading from 0.2.0-beta?** The service fee changed from 0.1% to 0.25% in 0.3.0-beta. Older sample clients reject the new rate. Review [the release changes](CHANGELOG.md) before updating your integration.

## Run it yourself

```sh
git clone https://github.com/apilabph/pumpfun-trade-api-public.git
cd pumpfun-trade-api-public
npm ci --ignore-scripts
```

Create a private `.dev.vars` file:

```ini
CUSTOMER_RPC_URL="https://YOUR_SOLANA_RPC"
```

Then run `npm run api:local`. Supply your own Jupiter routing key if required; see [customer RPC setup](docs/CUSTOMER-RPC.md). All reads, simulation, submission and confirmation use your RPC. No wallet keys belong in the API configuration.

## Development and limits

```sh
npm test
npm run check
npm run build:check
npm audit --audit-level=moderate
```

[Review and verification](docs/REVIEW.md) - [Security](SECURITY.md) - [License](LICENSE)

The local API is an unsigned transaction builder; the hosted Worker serves documentation only. The optional client helper executes inside the user's bot. Newly created tokens may not yet be indexed by Jupiter. Raydium, non-SOL pairs and unsupported token extensions fail closed. Your RPC and routing-provider limits apply; there is no uptime or execution guarantee.

The earlier custom Rust router is retained as an **experimental alternative**, with its own [review record](docs/CUSTOM_ROUTER_REVIEW.md). The default service does not use it and does not require its deployment.

MIT source can be forked and changed. We collect fees on successful transactions built with this fee configuration, not automatically from every copy of the code.
