# Architecture decisions

## ADR-001 — Transparent history-preserving fork

MPForge remains a Git descendant of WeMD and retains its MIT license and copyright. Upstream provenance is visible in the README, release notes, remotes, and source registry.

## ADR-002 — Project-local operational state

Package caches, browser binaries, Electron downloads, toolchains, source mirrors, temporary data, worktrees, and release artifacts live under the project root. No global package installation is used.

## ADR-003 — Deterministic safety core

Frontmatter validation, state transitions, linting, rendering hashes, approval gates, and receipts run without an LLM. AI-facing skills call these primitives instead of duplicating policy in prompts.

## ADR-004 — No automated formal broadcast

MPForge may create a draft after explicit approval but never performs a formal mass-send in v0.1.

## ADR-005 — One lifecycle policy, platform-specific storage ports

`@mpforge/content-schema` owns the Article model, migrations, transition graph, and event validation. `@mpforge/content-store` is the Node filesystem implementation used by CLI and desktop-capable flows; the Web storage adapters apply the same schema and transition primitives through browser/Electron ports. Status cannot be changed through an ordinary save, and `approved` additionally requires an explicit human action at the service boundary.

## ADR-006 — Deterministic HTML excludes build time

Markdown is parsed, normalized, rendered, styled inline, sanitized, canonicalized, and hashed without random identifiers, network access, or current timestamps. `generated_at` belongs only in `article.meta.json`; it never changes `article.html`. Light/dark simulation is preview-only and does not alter the formal light build.

## ADR-007 — State history has one canonical location

Round 1 lifecycle events use `content/<slug>/history/state-events.jsonl` with exact actor, reason, time, and source-commit fields. The old `audit.jsonl` name is retained only as legacy fork data; new CLI and Web state changes never append to it.

## ADR-008 — Approval is an evidence-bound human decision

`status: approved` is not sufficient evidence. Production approval requires an interactive human, a confirmed source hash, all ten checklist assertions, zero deterministic lint ERRORs, approved rights for every asset, and current build/preview/manifest hashes. Approval and invalidation records are append-only SHA-256 JSONL chains. Agents, Skills, MCP, CI, automation, and GitHub Actions cannot approve.

## ADR-009 — Media import is explicit and originals are immutable

Render and lint perform zero network downloads. A local or remote image enters the project only through an explicit import command with path-boundary or SSRF controls. The byte-hashed original is preserved under `assets/originals`; optimized and privacy-cleaned derivatives live under `build/assets` and remain traceable in `assets/manifest.json`.

## ADR-010 — Preview is a simulation, not a WeChat client claim

The canonical preview engine uses local Chromium at 375 px and 402 px, blocks all network requests, safely inlines article-local media, and records DOM/layout evidence. The UI always states that WeChat compatibility is simulated and requires final human confirmation in the WeChat draft box in a later round.

## ADR-011 — Draft creation is a two-phase operation

Prepare is deterministic and side-effect free: it validates the current release evidence, freezes an immutable snapshot, and writes a hash-bound plan. Execute reads only that snapshot. Mock execute is automation-safe; real execute requires a distinct one-time human side-effect approval after content approval.

## ADR-012 — Idempotency and uncertainty fail closed

The local ledger binds provider, account, article, source, compatible HTML, manifest, and approval. A successful, executing, or uncertain key cannot create another draft. A lost create response becomes `UNKNOWN_REMOTE_STATE`; only read-only reconciliation may resolve it, and no automatic create retry occurs.

## ADR-013 — Uploaded remote media is never described as rolled back

Every completed upload is persisted immediately. Later failure becomes `FAILED_WITH_REMOTE_ASSETS` with orphan-risk guidance. MPForge does not delete remote media automatically and does not claim a complete rollback.

## ADR-014 — The account adapter is draft-only

The provider surface is limited to capability/configuration checks, token acquisition, body/cover upload, draft create/read/list/search, and sanitization. Production capability scanning rejects any formal delivery or follower-distribution surface.

## ADR-015 — Hash-bound evidence is outside generic formatting

Approved article bytes, immutable operation snapshots, generated evidence bundles, and JSON reports may participate in SHA-256 bindings. Generic formatting hooks must not rewrite those paths. Changes are made only by the owning authoring or evidence-generation flow and must regenerate dependent review evidence.

## ADR-016 — Candidate construction and publication are separate authorities

Local and CI candidate construction is always non-publishing and invokes Electron Builder with `--publish never`. A public draft Release is a separate least-privilege job, requires a version tag plus the owner-controlled `MPFORGE_PUBLIC_RELEASE_AUTHORIZED=true` repository variable, and remains unavailable while release blockers are unresolved.

## ADR-017 — License-ambiguous inherited server is excluded

The `apps/server` component declared `UNLICENSED` at the pinned upstream commit. A later manifest-only change is not accepted as a license grant. MPForge v0.1.0 does not require this optional upload service, so Scheme A removes its source, tests, uploads, workspace importer, Docker references, dependency residue, SBOM entries, public-history objects and release artifacts. External image-host endpoints remain explicit, optional and fail closed when absent.

## ADR-018 — Public releases use a clean, default-deny source history

The local development repository retains inherited history as private provenance evidence and must never be pushed as the public repository. Public source is exported from an exact clean commit through an allowlist, checked against a denylist, initialized as a new Git repository, and scanned across every reachable ref and blob. The initial public commit identifies WeMD, the pinned upstream commit, inherited modules, MPForge additions, and the reason the public history is sanitized.
