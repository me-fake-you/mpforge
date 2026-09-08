# MPForge roadmap

Roadmap items are intentions, not shipped-feature claims. `PROJECT_STATE.md` and commit-scoped reports are the evidence source.

## v0.1.0 release gates

### Product path

- Content-as-Code create/edit/save flow with exact frontmatter preservation.
- Four original themes in editor and deterministic headless renderer.
- Linter UI, CLI output, safe fixes, and ERROR publishing gate.
- Local media import, hashing, deduplication, compression/conversion evidence, and rollback.
- Light, dark, and 375px mobile PNG preview generation.
- Human-only approval and audit history.
- Copy Mode and Mock Draft end-to-end receipt.
- Real Draft safe failure without credentials; real transport remains opt-in and never required by tests.
- CLI, MCP, and eight discoverable project skills.

### Release evidence

- Full unit, integration, security, and browser test suite.
- Web build and Windows Electron installer build on the release candidate commit.
- Dependency license report, secret scan, large-file scan, `.gitignore` review, and public-example review.
- Public repository/Fork with upstream history and notices.
- Manually triggered Pages demo with a verified URL.
- Current screenshots, Mock Draft self-hosting receipt, and demo GIF.
- `v0.1.0` tag and draft Release reviewed by a human before publication.

No item is complete merely because a workflow or source file exists.

## After v0.1

- Harden real WeChat transport deployments through explicit server-side adapters and credential providers.
- Expand accessibility, localization, migration, and recovery testing.
- Define a documented plugin/adapter protocol without copying restricted projects.
- Add upstream synchronization automation that preserves the fork boundary.
- Evaluate more export targets only when their API, trademark, privacy, and license boundaries are understood.

## Explicit non-goals

- Automatic formal broadcast or mass sending.
- Acquiring credentials in the browser.
- Removing watermarks, scraping copyright-unclear media, or committing private user assets.
- Hiding WeMD provenance or presenting MPForge as an official Tencent/WeChat product.
- Buying stars, fabricating users/downloads, or claiming unverified availability.
