# Review record — October 13, 2026

**Historical review of the experimental custom Rust router.** The default Jupiter service has its own [current review](REVIEW.md) and does not require the funding or deployment steps described below.

Scope: the public API, exact-fee CPI wrapper, routing checks, fee disclosure, examples, dependency configuration and public-release contents. This is an implementation review, not an independent security audit.

## Findings addressed

1. A precomputed sell fee could differ from 0.1% of actual proceeds. The program now measures the trade's actual SOL/WSOL balance delta before charging.
2. Checking a token's stage only in the API leaves a race before execution. The program revalidates the canonical curve's completion flag before invoking the trade. It also binds graduated trades to the canonical pool PDA.
3. A graduation between the two API snapshots could be misreported as missing migration. It now returns `VENUE_CHANGED`, requiring a fresh automatic route.
4. Measuring native SOL around account setup could include rent in the fee base. Volume initialization and ATA setup happen outside measurement. Account-size changes inside native trade CPI fail closed.
5. A WSOL buy could spend the whole prefunded amount before fee collection. It now prefunds the input plus the maximum service fee; actual fee still uses actual spend.
6. Buy funding checks now include the maximum service fee and network fee. Rent remains separate and simulation catches additional account-funding requirements.
7. Missing program configuration must not produce an uncharged build. Builds fail closed until an executable router address is configured.
8. Public docs and examples identify this as a standalone, undeployed preview. API calls and quotes do not generate trading fees.
9. A new recipient wallet may not yet exist on chain. Native builds now return an operator setup error instead of relying on a small first fee transfer to initialize it. A read-only launch check found that recipient setup is still required; no funds were moved.
10. Standalone authentication uses `API_KEY` and standard bearer authorization throughout the implementation, examples and OpenAPI contracts. Missing configuration fails closed; incorrect credentials return 401 with a bearer challenge. Keys never appear in error responses.

## Verification

- JavaScript tests exercise both venues, both trade directions and cashback variants, fixed fee recipient, whole-transaction serialization, unknown fee-override rejection, integer rounding, gross/net output, SOL funding, stage races, simulation failure, RPC limits and existing WSOL preservation.
- Rust host tests cover integer arithmetic, malformed packets, all eight instruction variants using mocked CPI, actual-versus-quoted fee differences, wrong signer/recipient/program/WSOL owner/mint, noncanonical pool, stage changes, and no fee transfer after a failed trade invocation.
- Rust formatting and Clippy run with warnings treated as errors. JavaScript syntax, OpenAPI schemas, Worker bundling and npm dependency audit are checked.
- CI includes Node 22/24, Rust host checks and SBF compilation. The README badge links to actual run status; a configured job is not proof that it passed.
- A separate Linux/macOS LiteSVM suite loads the compiled fee router and a compiled mock market. It tests actual runtime fee transfers, all eight instruction variants, stage/recipient rejection and atomic rollback after a later instruction fails. The mock market is a test double, not Pump's implementation, and is never deployed. Its dependencies are isolated from the API runtime.
- [CI run 38284556916](https://github.com/aguilardmarkanthony/pumpfun-trade-api-public/actions/runs/38284556916) passed the host checks, SBF compilation and all 11 local VM tests. This verifies the mock-market scenarios, not live protocol compatibility.
- The public export starts with a new history. Private deployment records, encrypted credentials, research files and the original repository's history are excluded.

## Limits and remaining release work

Rust host CPI tests use deterministic stubs. The separate LiteSVM suite exercises the compiled router's runtime execution with mock markets; it still does not validate real Pump/PumpSwap behavior. API simulations in offline tests use fixtures. This fee-bearing edition has not been simulated against a deployed real-protocol router, and no real trade has been signed or sent. Local VM tests disable signature verification and use artificial balances; they are not mainnet submissions.

Before operational release, validate the compiled program in a validator environment with current protocol accounts, then verify an owner-controlled deployment and repeat unsigned real-protocol simulations. Measure compute usage and packet sizes for real account layouts. Have a separate reviewer audit the program before exposing customer funds.

Native trades that allocate or resize accounts inside CPI intentionally reject rather than risk charging on rent. Unsupported future protocol changes require reviewed updates. First-use volume initialization can race another transaction and need a rebuild. Large routes can exceed the v0 packet limit; lookup tables are not implemented. Routing validation reduces avoidable errors; it does not guarantee execution.
