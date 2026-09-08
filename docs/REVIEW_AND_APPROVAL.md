# Review and human-bound approval

Round 2 separates lifecycle status from approval evidence. Setting
`status: approved` in `article.md` is not an approval.

## Quality gate

The review surface combines current article/build hashes, deterministic lint
diagnostics, asset provenance and rights, source/safe/WeChat-simulation
previews, layout findings, and a ten-item human checklist. ERROR diagnostics,
stale evidence, missing builds/previews, unresolved asset rights, or an
incomplete checklist block approval. Warnings remain visible and must be
explicitly acknowledged by the reviewer.

Approval is available only from `reviewed`. The operator must be an interactive
human, identify themselves, confirm the current source hash, and complete every
checklist item. Agent, Skill, MCP, CI, automation and GitHub Action actors are
rejected by the production policy. MCP deliberately exposes no approve tool.

## Evidence binding

Successful approval appends a record to
`content/<slug>/history/approvals.jsonl`. It binds the reviewer and time to the
current source, rendered HTML, WeChat-compatible HTML, lint report, asset
manifest, theme and source commit, together with the checklist and acknowledged
warnings. Records are append-only and hash chained so later editing is
detectable.

CLI approval is interactive. It displays hashes, warnings and asset rights,
asks the reviewer to complete the checklist, and has no `--yes` bypass.

## Invalidation and revocation

A change to article source/Frontmatter, referenced assets or manifest, theme,
renderer or linter version, build output, cover, lifecycle state, or critical
publish settings makes the bound approval stale. The article returns to a
review-required state and an append-only record is written to
`history/approval-invalidations.jsonl` with previous/current hashes and reason.

Revocation is an explicit human decision and uses the same invalidation log.
Old approvals remain historical evidence but can never authorize a later build.

Approval grants no permission to create a real WeChat draft or formally
publish. Those are separate side-effect gates.
