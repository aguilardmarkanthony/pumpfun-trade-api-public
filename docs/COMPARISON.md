# Choosing a Pump trading API

Reviewed October 13, 2026. This compares published interfaces, not a paid benchmark or an independent security assessment. A feature missing from a documentation page is not proof that a competitor lacks it internally.

| Item | Pump Trade Router | PumpApi | PumpPortal Local |
| --- | --- | --- | --- |
| Published service fee | 0.25% | 0.25% | 0.5% |
| Local signing | Yes | Yes | Yes |
| Automatic routing | Pump curve / canonical PumpSwap only | Broader pool selection | `auto` across supported pools |
| Local build response | JSON containing unsigned transaction, output bounds, simulation and cost fields | Serialized unsigned transaction | Serialized unsigned transaction |
| Caller-selected service-fee ceiling | `maxServiceFeeBps`, checked before upstream calls | Not documented on the reviewed trade page | Not documented on the reviewed local trade page |

Sources: [PumpApi fees](https://pumpapi.io/fees), [PumpApi trading interface](https://pumpapi.io/trade-api), [PumpPortal fees](https://pumpportal.fun/fees/), [PumpPortal local interface](https://pumpportal.fun/local-trading-api/trading-api/). Service fees do not include protocol charges, network fees or account rent. Exact fee bases and other features vary.

## Our focus

Wallet and bot developers can display the market, minimum output, simulated service fee, setup rent and expiry without decoding those fields from transaction bytes themselves. A fee ceiling lets an integration stop when pricing exceeds its accepted budget. The included client checks the encoded fee and output bounds before returning a transaction for signing.

Every hosted build requires unsigned simulation, checks the fee transfer against that simulation's swap event and rechecks the token stage. The implementation and regression tests are public. Fee-account reads are batched into the pricing snapshot to eliminate one sequential RPC call. See [usage](USAGE.md), [review](REVIEW.md) and [performance](PERFORMANCE.md).

These are reasons to evaluate the service, not evidence that it is faster or safer than every alternative. Both competitors already support local signing and automatic routing. They cover more markets; we currently support only SOL-paired Pump curves and canonical PumpSwap pools. We do not provide transaction delivery, Jito bundles, trading history or a production SLA. Public beta capacity is limited. First-trader fee-account rent can outweigh commission on a small trade.

## PumpDev screenshot follow-up

The owner supplied a PumpDev homepage screenshot during this review. Its detailed [pricing page](https://pumpdev.io/fees) lists **0.25% for local trades** and **0.5% for Lightning trading**. Our 0.25% matches the comparable local service; the homepage's prominent 0.25% label should not be read as its Lightning rate.

PumpDev also offers client-side signing and curve/PumpSwap handling. Its reviewed [local trading reference](https://pumpdev.io/trade-api) documents a binary transaction response, percentage sells and non-SOL quote assets. It does not list a caller-selected service-fee ceiling or a structured simulation/cost report on that page. Our JSON response and `maxServiceFeeBps` are concrete interface differences, not proof that PumpDev has no internal validation. Neither local signing nor automatic routing is unique to us.

PumpDev's [homepage](https://pumpdev.io/) advertises token creation, WebSocket feeds and Jito bundles, which this service does not implement. Its [Lightning setup](https://pumpdev.io/lightning-setup) describes server-side signing with a prepared wallet; this repository remains an unsigned builder. No competitor trade was executed and no comparative speed benchmark was run. Their clear title, code example and documentation links are useful presentation references; their speed and lowest-fee claims are not our claims.

## What still needs customer validation

Published competitor prices show an established commercial category, not demand for this particular API. The buyer hypothesis is a wallet or bot developer who values a structured trade review and explicit cost controls more than broad venue coverage. The acquisition route is the public repository, runnable examples and voluntary developer evaluations; no outreach has been sent.

Before adding many venues, seek three independent integrations, measure repeat use and successful fee-bearing volume, and estimate RPC/hosting/support cost per completed trade. Track rejected builds and upstream availability alongside latency. At 0.25%, gross revenue is 2.5 SOL per 1,000 SOL of successful fee-basis volume; it is not revenue per API request. Open-source forks can change or remove fees.
