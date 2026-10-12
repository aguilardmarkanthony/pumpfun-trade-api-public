# What affects transaction speed

Release 0.3.0-beta combines fee-account/router reads with the confirmed pricing snapshot, saving one sequential RPC request per quote/build. No simulation or stage check is skipped. Four local real-protocol builds used seven RPC calls each and took 434-713 ms; [recorded samples](verification-0.3.0-local.json). These measurements are not transaction confirmation times, a sustained benchmark or a guarantee for other regions. An earlier attempt encountered upstream slot lag and failed closed.

The customer's internet connection matters, but it is only one part of the path:

`client -> this API -> RPC + Jupiter -> unsigned transaction -> customer signs -> submission RPC -> validators -> confirmation`

This API builds and simulates transactions. It does not sign them or submit them to validators. A bot running on a server uses that server's network connection; the operator's home connection is not involved in each trade.

| Stage | Main sources of delay |
| --- | --- |
| Request and build | Client-to-API latency, RPC responses, Jupiter routing, simulation, rate limits and retries. |
| Signing | Wallet confirmation for interactive users, or local signing by an authorized bot. |
| Submission | The chosen RPC's location, load and ability to forward transactions to current validators. |
| Inclusion | Network congestion, account contention, compute budget and priority fee. |
| Confirmation | Waiting for processed, confirmed or finalized status takes different amounts of time. |

An RPC returning a transaction signature means it accepted the submission, not that the trade succeeded. Track its status and inspect the final error/result. [Solana sendTransaction documentation](https://solana.com/docs/rpc/http/sendtransaction).

## What we measured

Four hosted 0.3.0-beta unsigned builds on October 13, 2026 took 1,187 ms (curve buy), 689 ms (curve sell), 545 ms (PumpSwap buy) and 545 ms (PumpSwap sell), measured from the release machine. Each used seven RPC calls. These timings include API access, routing and simulation, not signing, broadcasting or confirmation. This small sample is not a latency guarantee, a percentile benchmark or a controlled comparison with the previous release. [Recorded results](verification-0.3.0-hosted.json).

The verified optimization removes one serial RPC round trip. Measuring p50/p95 under representative load and across regions is still required before advertising sustained subsecond response times or comparing speed with competitors. Shared beta rate limits and upstream availability are material limits; no paid infrastructure upgrade was enabled.

## Client guidance

The [local bot helper](BOT-EXECUTION.md) combines build, signing, submission and status tracking in one function call and records each stage's elapsed time. It keeps simulation, local checks and RPC preflight enabled. This reduces integration work; no live execution benchmark was performed and the helper is not evidence of lower confirmation latency.

Use a healthy RPC with low latency from the machine running the bot. Build close to signing time, honor rate limits, and track the returned blockhash expiry. When rebroadcasting, resend the same signed bytes while they remain valid; creating a new signed order before resolving the first one's status can cause a duplicate trade. [Solana retry guidance](https://solana.com/developers/cookbook/transactions/retry).

The `priorityFee` input is a maximum budget in lamports and defaults to zero. It is separate from our 0.25% service fee. A priority fee can improve inclusion priority during congestion, but does not guarantee a successful or faster trade. The builder uses a 400,000 compute-unit limit and converts that budget into a bounded compute-unit price. [Solana fee documentation](https://solana.com/docs/core/fees).

Slippage is a price tolerance, not a network-speed setting. Raising it can allow a worse execution price. Keep simulation enabled and rebuild after a confirmed stage change instead of repeatedly sending a stale route.
