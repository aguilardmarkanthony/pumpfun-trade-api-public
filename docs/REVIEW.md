# Review record - October 13, 2026

## Customer RPC migration — October 13, 2026

The customer process now performs chain reads, transaction preparation and simulation through its explicit RPC. The hosted Worker defaults to documentation-only mode and returns HTTP 410 CUSTOMER_RPC_REQUIRED for former chain operations, even if old operator secrets remain. Local signing/submission stays with the bot. The fee rate/recipient and protocol validation are unchanged.

Review fixed implicit public-RPC fallback, stale hosted quickstarts, missing-RPC error handling and browser chain forwarding. 98 automated tests, syntax/specification checks, Worker dry-run and dependency audit passed. [Recorded local evidence](evidence/customer-rpc-local-review.json). No funded trade, settlement deployment or live chain request was performed for this migration.

Customers must follow [the migration guide](CUSTOMER-RPC.md). EVM settlement and funded-trade requirements remain. Code-only website previews remain local. Deployment/readback evidence is recorded separately.


## Local bot execution review

The owner chose signing inside each user's bot. Added `executeTrade`, read-only `trackTrade`, strict pre-sign inspection and a file journal as Node client examples. No server endpoint signs or broadcasts; the hosted runtime and OpenAPI contract remain 0.3.1-beta. The fee remains 25 bps to the existing recipient.

Review found that the earlier basic client inspection was insufficient for automatic signing. The execution path now reconstructs every outer instruction, validates canonical market/protocol and the SOL token program, rejects extra transfers and compute changes, preserves existing WSOL, and validates lookup-table owner, activation and addresses. Lookup reads are cached within inspection. The signer must return the identical message with a valid Ed25519 signature. Estimated network and fee-account setup costs have explicit ceilings; these estimates do not cap all on-chain account rent.

Review also addressed ambiguous submission and recovery: reserve a stable order ID before building, persist its signature before sending, keep preflight enabled, accept confirmed/finalized status only, and never infer non-execution solely from a missing signature after expiry. Lost replies, hanging providers and cancelled tracking return uncertainty with the original signature. An exception after a possible send must never be labeled `not_submitted`. Signing and RPC waits are bounded, and no timeout creates a new signature. A repeated order ID performs status lookup only. Interrupted reservations fail closed; the file adapter is for persistent local disk on one machine, not a distributed execution guarantee.

Twenty new tests exercise all four synthetic trade directions/stages, valid and modified signatures, extra instructions, cost limits, RPC errors/timeouts, confirmed failures versus processed errors, expiry, cancellation (including during an RPC wait), restart/read-only recovery, journal failures, atomic reservations and lookup-table ownership/activation. The existing four builder tests also pass their output through strict execution inspection. All signatures in these tests use ephemeral local fixture wallets with synthetic non-executable instructions and mocked HTTP/RPC. No live trade is signed, submitted or used to measure performance. This is an internal code review, not an independent security audit.

Local verification passed all 92 JavaScript tests, syntax/OpenAPI/documentation-link validation, Worker dry-run bundling and dependency audit (zero vulnerabilities). See the [bot guide](BOT-EXECUTION.md) for setup, return states and limitations. GitHub Actions verifies Node 22/24 and the existing experimental Rust program on publication; deployed HTML release evidence remains separate.

## 0.3.1-beta documentation delivery review

The public origin previously returned a JSON 404 at `/`. Added a static HTML quickstart, robots file and sitemap at the existing origin. The Worker dispatches only these three exact paths before the existing API service. They make no RPC calls, expose no infrastructure credentials and support GET/HEAD only. API authentication, fee ceilings, rate limiting and transaction validation remain in the original service. Canonical links use a fixed published origin; request host/query text is never interpolated. A restrictive content security policy prevents scripts, embedding and form submission.

Review fixed stray `+` characters in the generated curl example and removed a duplicated fee value from the page metadata. The example test decodes the published HTML and validates both request bodies against the current input parser. Regression checks also cover HEAD/405 behavior, canonical-host injection, the sitemap and trade protection at the actual Worker entry point. The OpenAPI generator now reads the runtime version instead of maintaining a second version literal.

The original 67 JavaScript tests and five new documentation/entry-point tests pass. Syntax/OpenAPI/link validation, Worker dry-run bundling and the dependency audit pass. Search Console ownership and Google indexing remain unverified; successful delivery is not a search ranking claim. Runtime deployment evidence is tracked in [deployment](DEPLOYMENT.md).

## 0.3.0-beta review

The owner requested a 25-bps (0.25%) fee. Review found hard-coded 10-bps checks in the upstream instruction audit, response, sample client and experimental Rust program. Those now agree on 25 bps; JavaScript response/audit logic uses the shared fee constant. Arithmetic tests cover rounding below one lamport and u64 maximum amounts. No fee recipient changed.

Added `maxServiceFeeBps` to quotes and builds. Regression tests check both engines and trade directions, malformed limits, rejection before RPC work, HTTP 409 errors and positive acceptance at 25 bps. A higher ceiling cannot override the fee. The sample client supplies an explicit ceiling and rejects mismatches in the serialized rate. Review also found that its output amount checks were incomplete: it now compares the response's expected/minimum output with the encoded transaction.

Performance review combined the fee-account/router read with the confirmed pricing snapshot. It removes one sequential RPC call; the final stage check and mandatory simulation are retained. Regression tests verify batching for both venues, and existing tests still reject bad accounts, changed stages and failed simulations.

All 67 JavaScript tests, syntax/OpenAPI checks, Worker dry-run bundling, npm audit (zero vulnerabilities), Rust formatting, three Rust host tests and Clippy passed locally. Four fresh unsigned real-protocol simulations passed at 25 bps; [local results](verification-0.3.0-local.json) used seven RPC calls per build and took 434-713 ms from the development environment. One earlier four-request attempt failed with RPC minimum-context-slot errors; a fresh attempt succeeded without weakening slot validation. These are sample timings, not a latency SLA or capacity test. Hosted results and CI status are recorded in [deployment](DEPLOYMENT.md).

The experimental Rust program is still undeployed. [CI run 38290653485](https://github.com/apilabph/pumpfun-trade-api-public/actions/runs/38290653485) passed Node 22/24, Rust host checks, SBF compilation and all 11 VM tests with the new fee amounts. The deployed Jupiter service separately passed [four hosted real-protocol simulations](verification-0.3.0-hosted.json), public version/fee checks and 409 rejection of the old 10-bps ceiling. No real trade was signed or submitted.

## Historical 0.2.0-beta review

Scope: standalone Jupiter-based API, public access, recipient setup, fee disclosure, client examples and deployment separation. This is an implementation review, not an independent security audit.

## Findings fixed

- Removed the marketplace-specific authentication and documentation from the public project. Public mode needs no API key; private self-hosting can use standard bearer authentication.
- Removed the custom-program deployment and owner funding requirements from the default path by using Jupiter's existing on-chain router. The experimental Rust path remains separate.
- Validated the mainnet-published Jupiter Anchor IDL: route_v2 discriminator, integer input/output bounds, 10 bps fee, zero positive-slippage fee, one route, supported Pump variants and partial-fill flags. Partial curve fills are disabled. Unknown variants fail closed.
- Bound the trader, canonical token accounts, mints, token programs, selected market and fee account. Foreign signers, tips, additional routes and unexpected extra instructions are refused.
- Built account setup, SOL wrapping and cleanup locally instead of forwarding upstream instructions. Existing WSOL accounts remain open. Account rent is disclosed separately from commission.
- Resolved lookup tables from confirmed on-chain accounts and compared their contents with the upstream response. Unavailable, deactivated, recently extended or mismatched tables are rejected.
- Required simulation for every Jupiter build and inspected its actual fee transfer and swap event. Reading a recipient balance delta against an earlier snapshot could include another customer's payment; the fee check now uses only this transaction's inner instructions.
- Added public edge rate limits, IPv6 /64 grouping, a shared per-location limit and explicit failure when protection is missing. No API-key distribution is needed. These approximate limits are not a global quota.

## Verification

Node tests cover routing, tampered fees, recipients, amounts, slippage, signer changes, forced simulation, RPC failures, missing fee evidence, existing WSOL preservation, private bearer access and public rate limits. Syntax, OpenAPI validation, Worker bundling and dependency audit also run in CI on Node 22 and 24.

All 61 JavaScript tests passed for the deployed implementation, and [CI run 38287467206](https://github.com/apilabph/pumpfun-trade-api-public/actions/runs/38287467206) passed Node 22/24 checks, Rust checks, SBF compilation and all 11 custom-router VM tests. The hosted default Jupiter path separately passed the four mainnet simulations in [the release record](verification.json). Public rate limiting returned 429 with `Retry-After: 60`.

The content review updated the GitHub owner to `apilabph`, removed invalid text encoding, linked the live endpoint, marked manual wallet setup as optional and added checks for broken documentation links, version disagreement and an accidental API-key requirement in the public quickstart. Public examples require no marketplace subscription or customer key.

Unsigned mainnet simulations passed for curve buy/sell and canonical PumpSwap buy/sell with the recipient WSOL account initially absent. They verified automatic account creation, nonzero 0.1% fee transfers, transaction sizes below 1,232 bytes and compute use below the 400,000-unit cap. No private keys were loaded, no signatures created, no trades broadcast and no balances changed. This evidence covers the tested tokens and current protocol versions, not every token or future upgrade.

The earlier compiled custom Rust router separately passed 11 LiteSVM tests against mock markets. That is not mainnet evidence for the custom router. See [its review record](CUSTOM_ROUTER_REVIEW.md).

## Remaining limits

Prices and stages can change after simulation. A signed transaction does not reroute itself; clients must rebuild when migration or expiration occurs. Jupiter can be unavailable or slow to index a new token. Unsupported instruction changes fail closed until reviewed. No on-chain transaction has been executed by this release process, so simulations must not be described as earned revenue or completed settlement.

The owner receives WSOL. The first successful trader may pay the recipient account's creation rent; clients must show that extra cost. The service is noncustodial: the API never accepts a wallet key, signs or broadcasts. Public-source forks can remove the fee.

Only this public repository and its separate Worker are release targets. Existing services, their credentials, pricing and configurations are outside this release.
