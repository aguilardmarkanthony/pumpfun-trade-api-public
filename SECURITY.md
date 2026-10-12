# Security and reporting

This is a developer preview, not an independently audited trading service. Do not use it with real funds before validating the deployed program and its real-protocol behavior.

The API accepts public addresses and order parameters. It never needs wallet secrets. Do not include private keys, seed phrases, RPC keys, API passwords or signed transactions in issues or pull requests.

Please use GitHub's private vulnerability reporting for security findings where available. Public issues are suitable for documentation and non-sensitive bugs. Include the source commit and a minimal fixture that reproduces the issue.

The program has a fixed recipient and fee rate, no custody vault, no stored balances, and a narrow CPI program/instruction allowlist. These choices reduce the attack surface; they do not replace an independent audit or deployed-binary verification. A deployment's upgrade authority must be disclosed by its operator.
