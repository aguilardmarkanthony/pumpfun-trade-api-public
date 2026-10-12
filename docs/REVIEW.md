# Review record - October 13, 2026

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
