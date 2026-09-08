# MPForge threat model

## Protected assets

- WeChat AppID/AppSecret and access tokens;
- reviewed article content, images, approvals, and immutable operation snapshots;
- account selection, one-time side-effect challenges, idempotency ledger, remote identifiers, and receipts;
- the boundary between local Mock evidence and live-account evidence.

## Trust boundaries

The Web renderer is untrusted for credentials and filesystem paths. Electron IPC is a narrow server-side boundary that resolves the selected article inside the selected workspace. Providers receive credentials only immediately before a permitted server-side call. MCP, agents, skills, CI, browser code, and background automation are never trusted to authorize a real draft side effect.

The local Mock service is trusted only as a deterministic test dependency. It binds to loopback, does not contact the public network, and cannot produce live evidence.

## Principal threats and controls

| Threat                                                                | Control                                                                                                                      |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Secret in browser, bundle, log, error, URL, receipt, or Git           | Environment/credential-manager source; no secret IPC fields; recursive provider sanitization; source and bundle scans        |
| Path traversal or symlink escape during asset/snapshot access         | Canonical workspace/article resolution, realpath containment, immutable content-addressed originals, snapshot hash inventory |
| SSRF through remote image import                                      | Explicit click/command only; protocol, DNS/IP, redirect, timeout, size and MIME policy in shared media core                  |
| Stale preview or approval reused after edit                           | Source/render/WeChat/manifest/lint/preview/theme hashes; visible `STALE`; fail-closed Prepare and Execute                    |
| AI or automation approves content or real side effect                 | Actor checks, interactive-only approval, one-time bound challenge, CI/MCP/agent/pipe denial                                  |
| Double-click, refresh, retry, or concurrent process creates duplicate | Plan hash plus append-only idempotency ledger; in-progress/success/unknown states block the key                              |
| Create request succeeds but response is lost                          | `UNKNOWN_REMOTE_STATE`; no automatic retry; read-only three-result reconciliation                                            |
| Images uploaded but draft creation fails                              | `FAILED_WITH_REMOTE_ASSETS`; exact upload map and orphan risk; no false rollback or automatic remote deletion                |
| Mock response presented as live evidence                              | `mock: true`, `provider_mode: mock`, mock-only article state, explicit live-status vocabulary                                |
| Forbidden distribution capability added accidentally                  | Production-source static scan and CI failure; v0.1 provider surface allowlist                                                |
| Receipt or snapshot changed after creation                            | Per-file SHA-256 inventory, plan binding, receipt integrity hash, verification before every execute/read                     |
| Browser login or cookie automation bypasses API policy                | No browser automation or cookie transport in provider; server API only                                                       |

## Residual risks

Official API limits and account permissions can change. The create-draft API exposes no client idempotency key, and list ordering/matching is insufficient to resolve every lost response. Multiple plausible drafts therefore remain `AMBIGUOUS` and require a human console check. Remote material cleanup is not automated because deletion/reuse semantics are not proven safe in this round.

## Out of scope

MPForge Round 3 does not perform formal distribution, follower delivery, scheduling, browser-login automation, remote material deletion, or live-account testing without a separate explicit user-authorized run.
