# Draft receipts

A receipt proves which frozen inputs were used and what the local orchestrator observed. It records the operation and plan identifiers, provider mode, account alias, article/approval IDs, bound hashes, timestamps, uploaded-asset summary, remote draft identifier when known, verification result, terminal status, orphan-asset risk, and a receipt integrity hash.

Receipts never contain secrets, access tokens, cookies, authorization headers, raw credential-bearing URLs, request objects before sanitization, or unsanitized exceptions.

`provider_mode: mock` is mandatory for Mock operations. Such a receipt is local test evidence only. A receipt in `UNKNOWN_REMOTE_STATE` or `FAILED_WITH_REMOTE_ASSETS` is intentionally not a success receipt and must preserve the unresolved risk.

Receipt integrity detects local tampering; it does not turn a Mock response into a live response or independently prove the remote platform's state.
