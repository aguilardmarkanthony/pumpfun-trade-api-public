# API reference

Standalone unsigned Pump/PumpSwap trading API, version 0.3.0-beta. Default public access requires **no API key**. All responses are JSON with a request ID. Rate limits return HTTP 429 with `Retry-After: 60`.

| Method and route | Purpose |
| --- | --- |
| `GET /api/health` | Liveness and version; no upstream calls. |
| `GET /api/capabilities` | Access mode, router, fee policy and supported venues. |
| `GET /api/curve/{mint}` | Curve state and preliminary stage; it does not fully validate a pool. |
| `POST /api/quote` | Automatic route and quote; no signing, simulation or fee payment. |
| `POST /api/trade/local` | Validated and simulated unsigned transaction. |

POST bodies require `Content-Type: application/json` and are limited to 8,192 bytes. Unknown properties are rejected.

Required fields: `publicKey` (trader's public wallet), `mint`, `action` (`buy` or `sell`), and `amount`. Buys use SOL decimal strings up to nine decimals and 100 SOL. Sells use raw token-unit integer strings. `pool` defaults to `auto`. Optional `slippageBps` defaults to 100 (1%), from 1 to 5,000. `priorityFee` is an integer maximum budget in **lamports**, from 0 to 10,000,000; it is not a SOL amount. Builds require `simulate: true`, which is the default.

Only one-hop Pump curve and canonical SOL-paired PumpSwap routes are accepted. The builder checks chain state before routing and again after simulation. Unsupported token extensions, non-SOL pairs, incomplete migrations and unknown Jupiter instruction variants fail closed.

Optional `maxServiceFeeBps` is an integer from 0 to 10,000. `25` caps the service fee at 0.25%; `10` caps it at 0.1%. If the configured rate exceeds the limit, both quotes and builds return HTTP 409 `FEE_LIMIT_EXCEEDED` before any upstream calls. Omitting it accepts the published current rate. A higher ceiling does not raise the actual fee. This ceiling does not include protocol fees, network fees or rent; it is not a total trading-cost cap.

The fee is fixed at 25 bps to `54pRN3VR97d6ELqu7uBeB5eu8nTKPnjPp2q2nJhb7CRv`. It is included in buy input or deducted from actual sell proceeds and received as WSOL. If needed, the trader pays to create the fee-receiving account; the build discloses that rent separately. `expectedOut` and `minOut` are net of service fees. A simulation is not an actual trade receipt.

See [usage and examples](USAGE.md), [fees](FEES.md), [deployment](DEPLOYMENT.md) and the machine-readable [OpenAPI schema](openapi.json).

Private self-hosted instances may set `ACCESS_MODE=key` and require `Authorization: Bearer YOUR_API_KEY`. Customers do not need this header on a public instance. Neither mode accepts private wallet keys or submits trades.
