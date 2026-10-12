# Pump Trade Router

Buy and sell Pump tokens without guessing which market they use.

[![Checks](https://github.com/aguilardmarkanthony/pumpfun-trade-api-public/actions/workflows/ci.yml/badge.svg)](https://github.com/aguilardmarkanthony/pumpfun-trade-api-public/actions/workflows/ci.yml)

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

The endpoint and deployment verification are recorded in [Deployment](docs/DEPLOYMENT.md). With the API running locally:

```sh
curl http://localhost:8787/api/quote \
  -H "Content-Type: application/json" \
  --data '{"publicKey":"YOUR_PUBLIC_WALLET","mint":"TOKEN_MINT","action":"buy","amount":"0.01","pool":"auto","slippageBps":100}'
```

Replace both addresses. On Windows PowerShell, use `curl.exe` and put the command on one line. A quote does not trade or collect a fee.

Change `/api/quote` to `/api/trade/local` to receive an unsigned base64 transaction. For a sell, use `"action":"sell"` and a raw token amount: `"1000000"` means one token with six decimals.

[Step-by-step usage and JavaScript](docs/USAGE.md) � [API reference](docs/API.md) � [OpenAPI](docs/openapi.json)

## Fees, without surprises

| Item | What happens |
| --- | --- |
| Buy | 0.1% of the requested SOL input goes to the service; the remainder funds the swap. |
| Sell | 0.1% of actual SOL proceeds is deducted before the trader receives the rest. |
| Fee destination | `54pRN3VR97d6ELqu7uBeB5eu8nTKPnjPp2q2nJhb7CRv`, in wrapped SOL. |
| First use | If the service's receiving account is missing, the first trader funds its creation. The build discloses the rent separately. |
| Network and protocol costs | Separate from our fee; account rent may also be needed for the trader or protocol. |

For a 1 SOL buy budget, the service fee is 0.001 SOL. Fees round down to whole lamports. Wrapped SOL represents SOL 1:1 and is controlled by the recipient wallet.

The operator does not approve customer trades or pay an initial 0.005 SOL deposit. Customer-side signing remains necessary. If a trade fails, its service fee and account creation roll back; Solana may still charge the network fee. [Full fee details](docs/FEES.md).

## Run it yourself

```sh
git clone https://github.com/aguilardmarkanthony/pumpfun-trade-api-public.git
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

[Review and verification](docs/REVIEW.md) � [Security](SECURITY.md) � [License](LICENSE)

This is an unsigned transaction builder, not an execution service. Newly created tokens may not yet be indexed by Jupiter. Raydium, non-SOL pairs and unsupported token extensions fail closed. Public beta request limits protect shared capacity; there is no uptime or execution guarantee.

The earlier custom Rust router is retained as an **experimental alternative**, with its own [review record](docs/CUSTOM_ROUTER_REVIEW.md). The default service does not use it and does not require its deployment.

MIT source can be forked and changed. We collect fees on successful transactions built with this fee configuration, not automatically from every copy of the code.
