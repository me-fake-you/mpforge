# Changelog

All notable MPForge changes are recorded here. This file describes repository source, not deployment status. A version is released only after its tag, checks, artifacts, and public Release are independently verified.

## Unreleased — candidate v0.1.0

### Fork provenance

- Forked [tenngoxars/WeMD](https://github.com/tenngoxars/WeMD) with complete Git history at commit `964525d80ef63477c3a4b0327fe2a43415ee2bad`.
- Retained the upstream MIT license, copyright, and third-party attribution.
- Recorded inherited, replaced, and new module boundaries in `UPSTREAM.md` and dependency/asset provenance in `THIRD_PARTY_NOTICES.md` and `third_party/SOURCE_REGISTRY.md`.

### Added in source

- Content-as-Code article schema, Windows-safe paths, status transitions, and append-only audit events.
- Deterministic WeChat compatibility linter with JSON, text, GitHub annotation, and safe-fix outputs.
- Local media resolution, rights confirmation, SHA-256 deduplication, safety validation, conversion/upload abstractions, and rollback handling.
- Four original themes: `minimal`, `academic-blue`, `warm-editorial`, and `tech-dark-accent`.
- Headless light/dark renderer with repeatable output hashes.
- Approval-gated Copy, Mock Draft, and Real Draft adapter boundaries plus secret-free receipts.
- Local Mock WeChat service, Content-as-Code CLI, local stdio MCP server, and ten project-level Codex skills.
- Dashboard, Editor, Review, Assets, Publish, and Settings workbench views.
- Three public-safe example articles with original local SVG assets.
- Bilingual repository documentation, editable architecture diagram, launch material, issue/PR templates, and candidate CI/Pages/Windows release workflows.

### Round 1 — Core authoring loop

- Added `@mpforge/content-store` with atomic local writes, backups, conflict checks, recovery, project trash/restore primitives, filters, file watching, autosave control, and canonical state-event history.
- Completed the Article runtime schema, safe slug generation, migration, strict Frontmatter parse/validate/serialize, unknown-field preservation, and `version` increments.
- Wired real Dashboard search/status/theme filters, Frontmatter form/raw editing, auto/manual save states, explicit Review transitions, source/build hashes, and honest validation/lint/build placeholders.
- Added 375 px and 402 px WeChat-width simulation, preview-only light/dark modes, four versioned original themes, sanitized canonical HTML, and SHA-256 source/render/theme evidence.
- Added CLI list/show/validate/transition commands and deterministic `article.html` plus `article.meta.json` output through the shared core.
- Added three AI-assisted original example articles with self-authored MIT SVG artwork.
- Added Round 1 Web integration and Playwright coverage for create/edit/theme/build/reload/review/history/illegal-approval behavior.

### Round 2 — Quality gate and media pipeline

- Added a deterministic, LLM-independent preflight linter with structured diagnostics, stable fingerprints, stage-specific raw/safe/WeChat checks, transactional safe fixes, and JSON/HTML/SARIF output.
- Added official-source-backed WeChat compatibility configuration and documented the 2026-09-01 verification and remaining official-document ambiguity.
- Added explicit secure media scan/import/inspect/optimize/rights workflows, immutable content-addressed originals, SHA-256 deduplication, privacy-cleaned derivatives, manifest validation, SSRF defenses, MIME/pixel budgets, and active-SVG rejection.
- Added source/safe/WeChat renderer stages and a local Chromium preview engine for 375/402 px light/dark screenshots, safe local-image inlining, overflow/contrast/missing-image/browser-error reporting, and explicit simulation labeling.
- Added a shared human Review gate with a ten-item checklist, complete evidence binding, append-only hash-chained approval records, revocation, tamper detection, and automatic source-change invalidation.
- Expanded Web Review and Assets views with real lint states, six preview comparisons, asset provenance/rights/privacy/size fields, human approval/revocation, and visible invalidation reasons.
- Expanded CLI preflight/lint/assets/preview/review/approve/revoke commands and MCP read/check/prepare tools. No MCP approval or publishing tool exists in Round 2.
- Added linter/media/review/preview fixtures, bypass and tamper tests, real browser quality-gate E2E, CI SARIF/preview artifact handling, and project skills for article review and asset-rights checking.

### Round 3 — Safe WeChat draft pipeline

- Completed the Round 2 Web Assets and Chromium Preview evidence connections and added an original approved release-ready fixture plus a per-rule linter inventory.
- Added a persistent loopback-only Mock WeChat service with token, body image, cover, draft create/read/list/search, admin preview, sanitized logging, restart recovery, and fourteen fault modes.
- Added one draft-only provider contract with local Mock and official-contract Real implementations, conservative limits, error classification, candidate search, and request/response sanitization.
- Added immutable operation snapshots, complete evidence bindings, hash-inventoried files, plan/status/events, immediate upload maps, append-only idempotency ledger, partial-success records, receipts, and `UNKNOWN_REMOTE_STATE` reconciliation.
- Added a two-phase side-effect gate that blocks agent, MCP, Skill, CI, automation, background, piped, non-TTY, bypass-flag, and environment-approval real execution. Human challenges are short-lived, single-use, and bound to operation, account, and plan hash.
- Added account and operation CLI commands plus safe MCP prepare/read/mock/reconcile tools; MCP has no real execute capability.
- Added Accounts, Draft Preparation, Mock Draft, real human confirmation, Operations, and Receipt UI surfaces without exposing credential values.
- Kept untouched approved source byte-stable in Electron, added a read-only local-asset inventory for correct desktop linting, and made current-versus-STALE Chromium evidence explicit in the Review UI.
- CI is constrained to mock-only networking and scans secrets, the built Web bundle, dependency licenses, large files, and forbidden production capabilities.

### Round 5 — Local release candidate

- Passed the complete 19-workspace unit-test matrix, type checking, repository QA, production build, frontend secret scan, and all 27 Chromium E2E scenarios with real-account access disabled.
- Built unsigned Windows x64 NSIS and ZIP candidates from source commit `958c57bfb4f177af551e6b17ab7548b05eb27e4d`; recorded byte sizes and SHA-256 checksums under the project-local `artifacts/v0.1.0/` directory.
- Installed the NSIS candidate into an isolated repository-local directory, started the packaged application, verified product version `0.1.0.0`, then uninstalled it and confirmed application and shortcut cleanup.
- Removed MPForge workspace source, tests, build metadata, article content, operation evidence, and `apps/server` from the desktop package boundary while retaining required compiled runtime files.
- Protected hash-bound content and evidence from generic formatting hooks after a formatter changed an approved article byte sequence and correctly triggered the existing stale-evidence gates.
- Hardened release automation so Electron always runs with `--publish never`; public draft creation is a separate job available only after explicit owner authorization.

### Safety

- AI actors cannot set `approved`.
- Linter ERRORs block draft creation.
- Real draft attempts require an immutable approved snapshot, a named account alias, complete current evidence, server-side credentials, an allowed interactive human context, and a one-time plan-bound challenge.
- Receipts redact credentials and tokens.
- Formal broadcast and mass sending remain outside v0.1.

### Not yet asserted

- Public repository publication, GitHub Pages deployment, a `v0.1.0` tag, GitHub Release, a signed Windows installer, and real WeChat draft connectivity are not established by this changelog.
- The local unsigned Windows candidate is verified only by `reports/round5-verification.md` and `reports/windows-build-v0.1.0.md`; it is not a claim that a public download exists.

### Round 4 — Public release hardening

- Chose the conservative Scheme A resolution for the inherited license-ambiguous `apps/server`: removed its source, tests and sample uploads plus workspace, lockfile, Docker and CI dependencies; external upload endpoints are now optional, explicit and fail closed.
- Added a default-deny public source allowlist, denylist, clean-source exporter, all-ref history scanner, Docker/Web/npm/ASAR/archive boundary checks, and regression tests that reject server or private-data reintroduction.
- Added complete provenance, reimplementation, public-boundary and license-compatibility documentation while retaining the WeMD name, MIT copyright, upstream URL and pinned commit.
- Added browser-only Demo Mode with project-generated example content, an unmistakable `DEMO / MOCK` banner, browser-memory Mock WeChat operations, uncertainty reconciliation, and duplicate-prevention evidence. Demo bundles tree-shake known real API endpoints.
- Added source SPDX and runtime CycloneDX SBOM generation, checksums, build information, provenance and release-manifest generation without claiming binary reproducibility or Windows signing.
- Added Chinese and English release-facing documentation, launch-material drafts, GitHub issue templates, Dependabot, CodeQL, gated CI/security/release workflows, and a mock-only Pages workflow.
- Public repository, Pages, tag and Release claims remain pending until the clean public history, new artifacts, clean clones, install/uninstall flow and remote results are independently verified.
