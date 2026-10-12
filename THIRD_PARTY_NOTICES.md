# Third-party dependencies

This public implementation uses the official @pump-fun/pump-sdk 4.0.0 and @pump-fun/pump-swap-sdk 2.1.0 (MIT), @solana/web3.js 1.98.4 (MIT), @solana/spl-token 0.4.14 (Apache-2.0), and bn.js 5.2.5 (MIT). Dependency authors retain their copyrights. See package-lock.json for the exact transitive versions and installed package metadata/license files. Do not remove upstream notices when redistributing dependencies.

The local `vendor/bigint-buffer` adapter is original code implementing four unsigned conversion functions; it does not contain the upstream native addon or copy its implementation. It rejects overflow rather than truncating a value. Protocol documentation is referenced, not republished. Pump.fun and Solana names identify compatibility; no endorsement or affiliation is claimed.

Validation uses the MIT-licensed LiteSVM 1.6.0 and Solana Kit 8.0.0 in an isolated test package. The Rust program uses solana-program 2.3.0 and the dependencies pinned in its Cargo.lock; see their upstream license notices. The local mock market is original test code and is not the Pump or PumpSwap implementation. Build tools are fetched from the official Agave release and checked against its published SHA-256 digest.
