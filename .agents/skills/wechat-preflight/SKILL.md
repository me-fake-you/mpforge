---
name: wechat-preflight
description: Run MPForge deterministic lint and preview checks before an article can enter review or draft creation.
---

# WeChat preflight

Run `mpforge lint <article>`, `mpforge assets scan <article>`, and
`mpforge preview <article>`, then inspect the generated lint, asset, and preview
reports. Finish with `mpforge preflight <article>` so report hashes are checked
against the current article and build. Treat every ERROR, stale report,
unapproved asset right, or missing preview as a release blocker. Review warnings
for mobile overflow, filtered CSS, links, secrets, placeholders, provenance,
privacy metadata, and determinism.

Use source/safe/WeChat-simulation light and dark previews as evidence, not as
permission to publish. Never suppress a lint error by editing a report, invent
HTML to satisfy a check, silently import a remote image, acknowledge a human
checklist item, or change status to `approved`. Fix source or assets, rerun the
commands, and preserve the audit trail. The furthest this skill may advance an
article is a request for human review.
