# Public Pump Trade Router

- Review, fix findings, test, document, commit and push API updates.
- Unsigned API only. Never request wallet secrets, sign or submit a trade, or move funds for testing. Local validator fixtures are permitted; mainnet program deployment requires the owner's separate deployment wallet and funding decision.
- Fixed transparent 10 bps service fee for this edition, recipient 54pRN3VR97d6ELqu7uBeB5eu8nTKPnjPp2q2nJhb7CRv. Never substitute another wallet. Default Jupiter mode includes the fee in requested SOL buy input and deducts it from actual SOL sell proceeds. Fees settle as WSOL. Setup rent and network fees are separate; disclose first-trader fee-account rent.
- Validate program owners, canonical pool/curve identity, on-chain stage, signer, amounts and instruction allowlists. Fail closed on unsupported state, migration, unavailable router or stale RPC.
- Keep this standalone repository and its Worker separate from existing services. Do not edit or deploy any other service as part of this release.
- Public mode needs no customer API key or operator trade approvals; edge rate limits must be present. Optional bearer authentication is for private self-hosting only.
- The default uses Jupiter's deployed router and requires successful real-protocol unsigned simulations. The optional custom Rust program remains an undeployed developer preview. Never advertise earned commissions from simulations, or guarantee execution.
- Do not commit secrets, deployment keypairs, private history, operational snapshots or wallet payload logs.
