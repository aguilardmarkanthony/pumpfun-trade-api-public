# Release changes

## 0.3.0-beta - October 13, 2026

- Service fee increases from 10 bps (0.1%) to 25 bps (0.25%). The recipient remains unchanged. Buy fees stay inside the requested SOL budget; sell fees come from actual SOL proceeds. All fee amounts round down to whole lamports.
- Optional `maxServiceFeeBps` rejects quotes and builds with HTTP 409 `FEE_LIMIT_EXCEEDED` if the configured fee exceeds the caller's limit. It does not cap network fees, protocol fees or account rent. Examples send 25 explicitly.
- Fee-account and router reads now share the pricing snapshot, removing one sequential RPC request. Mandatory simulation, account validation and the final stage recheck remain enabled.
- The JavaScript example now checks that the displayed output bounds match the serialized transaction, as well as verifying its fee, recipient, signer and input amount.
- OpenAPI, examples, fee arithmetic and the experimental custom router are updated to 25 bps. The custom router remains undeployed and is not required by the hosted service.

Clients pinned to the old 10-bps policy intentionally reject the new fee. Review the new price and update the client before using this release. Sending `maxServiceFeeBps: 10` returns a fee-limit error; the server never silently increases the supplied ceiling.

See [deployment](docs/DEPLOYMENT.md) for live status and [review](docs/REVIEW.md) for verification evidence. No test transaction is signed or submitted.
