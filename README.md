# Pump Trade Router

Buy and sell Pump tokens without guessing which market they use.

[![Checks](https://github.com/apilabph/pumpfun-trade-api-public/actions/workflows/ci.yml/badge.svg)](https://github.com/apilabph/pumpfun-trade-api-public/actions/workflows/ci.yml)

Give the API a token mint, your public wallet address and an amount. It checks the token's on-chain stage, selects the bonding curve or canonical PumpSwap pool, and returns a simulated, unsigned transaction. Your wallet or bot signs and submits it.

**Standalone public beta.** No marketplace subscription, signup or API key is required in public mode. The API uses Jupiter's existing on-chain router; you do not deploy a custom Solana program. This repository contains both the API and the client examples.

## What it does

- Detects curve versus graduated tokens from chain state and checks again before returning a build.
- Restricts trades to one verified Pump or canonical PumpSwap market.
- Includes a transparent **0.1% service fee** in the same transaction as the trade.
- Simulates every build, verifies the simulated fee transfer and refuses unsupported or changed routes.
- Preserves existing wrapped-SOL accounts. Never asks for private keys.

Migration, price changes, blockhash expiry and network conditions can still cause a transaction to fail. If the venue changes, rebuild with `pool: "auto"`; an already signed transaction cannot switch venues by itself.

## First request

Public endpoint: **https://pump-trade-router.apilabph.workers.dev**. No API key is needed. [Deployment and verification](docs/DEPLOYMENT.md).

```sh
curl https://pump-trade-router.apilabph.workers.dev/api/quote \
  -H "Content-Type: application/json" \
  --data '{"publicKey":"YOUR_PUBLIC_WALLET","mint":"TOKEN_MINT","action":"buy","amount":"0.01","pool":"auto","slippageBps":100}'
```

Replace both addresses. On Windows PowerShell, use `curl.exe` and put the command on one line. A quote does not trade or collect a fee.

Change `/api/quote` to `/api/trade/local` to receive an unsigned base64 transaction. For a sell, use `"action":"sell"` and a raw token amount: `"1000000"` means one token with six decimals.

[Step-by-step usage and JavaScript](docs/USAGE.md) - [API reference](docs/API.md) - [OpenAPI](docs/openapi.json) - [Transaction speed](docs/PERFORMANCE.md)

## Trading costs

Successful trades include a **0.1% service fee**, paid in wrapped SOL: included in the requested SOL budget for buys, or deducted from actual SOL proceeds for sells. Network fees, protocol fees and account rent are separate.

If the service's receiving account is missing, the first trader pays its setup rent; the build reports this separately before signing. See [fee details, examples and the recipient address](docs/FEES.md).

## Run it yourself

```sh
git clone https://github.com/apilabph/pumpfun-trade-api-public.git
cd pumpfun-trade-api-public
npm ci --ignore-scripts
```

Create a private `.dev.vars` file:

```ini
SOLANA_RPC_URL="https://YOUR_SOLANA_RPC"
```

Then run `npm run dev`. The Worker configuration enables public access with rate limits and the Jupiter engine. A self-hosted private instance can opt into bearer authentication; see [configuration](docs/DEPLOYMENT.md). No wallet keys belong in the server configuration.

## Development and limits

```sh
npm test
npm run check
npm run build:check
npm audit --audit-level=moderate
```

[Review and verification](docs/REVIEW.md) - [Security](SECURITY.md) - [License](LICENSE)

This is an unsigned transaction builder, not an execution service. Newly created tokens may not yet be indexed by Jupiter. Raydium, non-SOL pairs and unsupported token extensions fail closed. Public beta request limits protect shared capacity; there is no uptime or execution guarantee.

The earlier custom Rust router is retained as an **experimental alternative**, with its own [review record](docs/CUSTOM_ROUTER_REVIEW.md). The default service does not use it and does not require its deployment.

MIT source can be forked and changed. We collect fees on successful transactions built with this fee configuration, not automatically from every copy of the code.
