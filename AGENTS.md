# Public Pump Trade Router

- Review, fix findings, test, document, commit and push API updates.
- Keep the public title and GitHub About description explicit about Pumpfun/Pump.fun buy and sell, Solana and PumpSwap. Use relevant topics and working examples; identify the project as independent. Preserve fee disclosure and measured performance limits. Do not add unsupported platforms or promise search rankings.
- Maintain the existing service's public HTML documentation, canonical URL, crawl rules and sitemap with its real capabilities. Verify published responses and Search Console status separately; a successful deployment does not prove Google indexing. Static discovery routes must never bypass trade protections or trigger upstream RPC calls.
- Unsigned API only. Never request wallet secrets, sign or submit a trade, or move funds for testing. Local validator fixtures are permitted; mainnet program deployment requires the owner's separate deployment wallet and funding decision.
- The owner chose execution inside each user's bot on October 13, 2026. Client helpers may invoke a user-supplied local signer and submission RPC; the hosted API remains unsigned. Verify using synthetic local fixtures and mocked transports only. Never execute a live trade during development or verification.
- Fixed transparent 25 bps service fee for this edition, recipient 54pRN3VR97d6ELqu7uBeB5eu8nTKPnjPp2q2nJhb7CRv. Never substitute another wallet. Default Jupiter mode includes the fee in requested SOL buy input and deducts it from actual SOL sell proceeds. Fees settle as WSOL. Setup rent and network fees are separate; disclose first-trader fee-account rent.
- Validate program owners, canonical pool/curve identity, on-chain stage, signer, amounts and instruction allowlists. Fail closed on unsupported state, migration, unavailable router or stale RPC.
- Keep this standalone repository and its Worker separate from existing services. Do not edit or deploy any other service as part of this release.
- Public mode needs no customer API key or operator trade approvals; edge rate limits must be present. Optional bearer authentication is for private self-hosting only.
- The default uses Jupiter's deployed router and requires successful real-protocol unsigned simulations. The optional custom Rust program remains an undeployed developer preview. Never advertise earned commissions from simulations, or guarantee execution.
- Do not commit secrets, deployment keypairs, private history, operational snapshots or wallet payload logs.

The owner requires customer-owned RPC for all application blockchain work. Customer mode runs reads/builds/simulations in the customer process; hosted chain endpoints must perform zero RPC calls. Require an explicit customer RPC with no implicit fallback. Keep the local signer and any routing credentials with the customer. Existing RapidAPI services are outside this migration.
