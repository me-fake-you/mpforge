# Optional live draft test runbook

Round 3 does not require live credentials or a live call. The default status is `LIVE_ACCOUNT_NOT_TESTED`.

If the repository owner later chooses to test their own account:

1. Use a non-production test article and verify the account alias in a controlled human session.
2. Supply AppID/AppSecret through the server environment or OS credential manager; never paste them into chat, Web UI, YAML, logs, or Git.
3. Run `mpforge account doctor <alias>` and inspect the capability result.
4. Build, lint, preview, review, and approve the exact content.
5. Run `mpforge draft prepare <slug> --account <alias>` and inspect every hash, call, side effect, and orphan-material warning.
6. Start real execute from an interactive human TTY or controlled Web confirmation page. Retype the one-time challenge shown for that operation/account/plan.
7. Inspect the created draft in the WeChat administration console. Do not take any later distribution action as part of this runbook.
8. Save only the sanitized receipt and read-only verification result. Rotate credentials if any scanner reports exposure.

Only an actual user-approved live draft with a sanitized receipt, remote identifier, successful read-only lookup, and user confirmation of the target account may add `LIVE_DRAFT_VERIFIED`. Otherwise retain `LIVE_ACCOUNT_NOT_TESTED`.
