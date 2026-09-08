---
name: release-audit
description: Audit an MPForge release for Git evidence, builds, tests, previews, licenses, secrets, and redacted publish receipts.
---

# Release audit

Collect evidence from git status, the pinned upstream record, dependency and
license notices, `mpforge doctor`, lint JSON/SARIF, asset manifests, preview
reports, approval/invalidation history, and build artifacts. Verify that every
report hash still matches current source/build/assets and that an approval did
not survive a later mutation. Run the repository test, typecheck, build,
security, browser, secret, and license checks appropriate to changed packages.
Verify example assets are public or rights-cleared and receipts contain hashes
and aliases but no tokens, cookies, AppSecrets, or complete credentials.

Report unsupported or untested features as limitations. Do not create a GitHub
release, upload assets, broadcast an article, complete a human checklist, or
mark an article approved as part of this audit. Use existing CLI/contracts and
never synthesize HTML, reports, approvals, or evidence.
