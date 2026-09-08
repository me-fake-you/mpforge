# Security policy

Report security issues privately to the repository owner after the public repository exists. Do not include secrets, private article content, or exploit payloads in public issues.

## Credential handling

- Real WeChat credentials are read only from the server/CLI process environment or an operating-system secret provider.
- The browser never receives AppSecret or access tokens.
- Logs, lint reports, previews, receipts, and Git commits exclude secret values.
- Secret scanning runs before release.
- Account YAML stores only environment-variable names and safe status metadata.
- Sanitized request/response files and receipts are rejected if sensitive keys or credential-bearing URLs survive redaction.
- The built Web bundle receives a separate credential-marker and secret-pattern scan.

## Publishing boundary

Real draft creation requires a current, hash-bound human approval record, zero
lint errors, approved rights for every referenced image, an immutable verified
snapshot, an unexpired plan, an explicit account alias, complete current
previews, and a separate one-time human side-effect approval. Article status
alone is never approval evidence.

Agent, Skill, MCP, CI, automation and GitHub Action actors cannot approve an
article. They may run deterministic checks and request human review. Interactive
approval has no unattended `--yes` path. Any source, build, theme, ruleset,
asset, manifest or critical setting change invalidates the old approval.

Real execution additionally rejects MCP, Agent, Skill, CI, GitHub Actions,
automation, background tasks, piped stdin, non-interactive terminals, bypass
switches, and environment-based approvals. The short-lived challenge binds the
operation id, account alias, and plan hash and is atomically consumed once.

## Remote uncertainty

- Each remote upload is recorded immediately; a later failure retains orphaned
  material evidence and never claims rollback.
- A create request without a definitive response becomes
  `UNKNOWN_REMOTE_STATE` and cannot be retried automatically.
- Reconciliation is read-only and can conclude created, not created, or
  ambiguous. Ambiguous operations remain blocked for human inspection.

## Untrusted content and media

- Markdown, Frontmatter, HTML, CSS, SVG and image metadata are untrusted.
- Lint and render never download a remote image. Import is a separate explicit
  operation with protocol, DNS/IP, redirect, timeout and byte limits.
- Local paths and resolved symlinks must remain inside the article/project
  boundary.
- MIME is detected from bytes; extension mismatch, malformed input, excessive
  dimensions/pixels and active SVG content fail closed.
- Original media remains under `assets/originals`; privacy cleanup and
  optimization write only derived `build/assets` files.
- Reports identify secret locations without echoing complete secret values.

See [THREAT_MODEL.md](THREAT_MODEL.md) for the current abuse cases and controls.

## Known dependency advisory

The 2026-09-08 official npm production audit reports 0 critical, 0 high and 1 moderate finding. The high-severity release gate passes without advisory ignores or exceptions; this is not a zero-vulnerability claim. This production audit excludes Electron because the packaging toolchain declares it as a development dependency, despite shipping its executable.

The shipped runtime was separately upgraded from Electron 28.3.3 (7 high, 20 moderate and 5 low npm advisories) to pinned Electron 44.2.0. The explicit exact-version runtime audit reports 0 Electron advisories as of 2026-09-08. `scripts/check-shipped-runtime.mjs` checks this runtime independently of the production graph and fails closed if the version differs or advisory lookup fails. Dated npm results do not guarantee absence of undisclosed issues or complete Chromium advisory coverage.

The remaining finding is [GHSA-gh4j-gqv2-49f6](https://github.com/advisories/GHSA-gh4j-gqv2-49f6): XMLBuilder comment/CDATA injection through `cos-js-sdk-v5@1.10.1 → fast-xml-parser@4.5.7`. The inspected SDK uses default XMLBuilder options without comment/CDATA configuration, but this does not establish universal non-exploitability. The default public Mock Demo does not configure or call COS; the optional configured COS uploader is a separate usage scope. The advisory remains open pending a compatible upstream fix or verified migration.

See the [dependency security review](reports/round4-dependency-security.md) for the audited lockfile hash, remediation details and verification evidence.
