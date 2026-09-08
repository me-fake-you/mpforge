# Draft idempotency

The local idempotency key binds provider, account alias, article ID, source hash, WeChat HTML hash, asset-manifest hash, and approval ID. `operations/ledger.jsonl` is append-only.

The same key is blocked while an operation is in progress, after success, or while the remote result is unknown. Browser double-clicks, refreshes, repeated CLI invocations, and concurrent processes therefore cannot create a second draft from the same plan.

The official create-draft API has no client idempotency field. Local idempotency prevents repeated MPForge calls but cannot prove the outcome of a request whose response was lost. Such a request enters `UNKNOWN_REMOTE_STATE` and is never retried automatically.

An intentional duplicate requires a new plan. For a real account it also requires a new one-time human side-effect approval.
