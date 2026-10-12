# Public Pump Trade Router

- Review, fix findings, test, document, commit and push API updates.
- Unsigned API only. Never request wallet secrets, sign or submit a trade, or move funds for testing. Local validator fixtures are permitted; mainnet program deployment requires the owner's separate deployment wallet and funding decision.
- Fixed transparent 10 bps service fee for this edition, recipient 54pRN3VR97d6ELqu7uBeB5eu8nTKPnjPp2q2nJhb7CRv. Never substitute another wallet. Fee basis is actual SOL/WSOL moved by the trade CPI, excluding setup, rent and network fees.
- Validate program owners, canonical pool/curve identity, on-chain stage, signer, amounts and instruction allowlists. Fail closed on unsupported state, migration, unavailable router or stale RPC.
- This is a public developer preview until the on-chain program has a reviewed deployment and real-protocol simulation evidence. Do not advertise live fees or guaranteed execution.
- Do not commit secrets, deployment keypairs, private history, operational snapshots or wallet payload logs.
