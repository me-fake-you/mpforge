# Local Mock WeChat

`apps/mock-wechat` is a loopback-only development service. It never accepts a real AppSecret, never contacts a WeChat hostname, and marks every successful JSON response with `mock: true`.

Run it only after activating `scripts/env.ps1`. Persistent data must use `tmp/mock-wechat/` or `artifacts/mock-wechat/`; tests use an isolated project-local or OS temporary directory and clean it afterwards.

The service models token acquisition, body-image upload, cover-material upload, draft creation, draft detail/list queries, capabilities, an HTML preview, sanitized request logs, counters, and fault selection. Faults cover credential, token, IP, permission, upload, cover, payload, server, invalid JSON, timeout, response-loss, duplicate, rate-limit, and partial-asset cases.

Mock receipts carry `provider_mode: mock`. A successful Mock operation does not change a real article to `sent_to_draft` and is never evidence that a live account was tested.
