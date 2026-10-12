# Security and reporting

This is a public beta, not an independently audited trading service. Default builds use Jupiter's deployed router with narrowly validated Pump routes and mandatory unsigned simulation. A successful simulation does not guarantee execution.

The API accepts public addresses and order parameters. It never needs wallet secrets. Do not include private keys, seed phrases, RPC keys, API passwords or signed transactions in issues or pull requests.

Please use GitHub's private vulnerability reporting for security findings where available. Public issues are suitable for documentation and non-sensitive bugs. Include the source commit and a minimal fixture that reproduces the issue.

The API fixes the fee recipient and rate, validates the route, constructs setup locally and stores no wallet secrets. Jupiter and Pump/PumpSwap programs are third-party dependencies; their authorities can change their implementations. Unknown instruction formats fail closed pending review. These checks do not replace independent review of the complete transaction before signing.

The optional custom Rust router remains an undeployed experiment. It has a fixed recipient, no custody vault and a narrow CPI allowlist. Any future deployment requires independent verification and disclosure of its upgrade authority.
