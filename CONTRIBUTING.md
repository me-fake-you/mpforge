# Contributing to MPForge

Thank you for improving MPForge. The project is a transparent fork of WeMD; contributions must preserve upstream history, attribution, the MIT license, and the safety boundaries below.

## Before you start

- Read `AGENTS.md`, `UPSTREAM.md`, `LICENSE_POLICY.md`, `SECURITY.md`, and `ARCHITECTURE.md`.
- Keep every checkout, worktree, download, dependency cache, browser, temporary file, and build artifact under the MPForge repository root.
- Do not install packages globally. On Windows, activate `scripts/env.ps1` and use `scripts/pnpm.ps1`.
- Never use private user articles, real account aliases, credentials, or unlicensed media as a reproduction.
- Discuss legal uncertainty, major architecture conflicts, publishing safety, or incompatible licenses before implementation.

## Local setup

```powershell
Set-Location <path-to-mpforge>
. .\scripts\env.ps1
.\scripts\pnpm.ps1 install --frozen-lockfile
```

The wrapper redirects npm, pnpm, Electron, Playwright, Corepack, and temporary paths into the project. A pull request must not introduce user-profile cache paths or require a global package.

## Change rules

### Source and license provenance

- Prefer dependencies or adapters over copied source.
- Register every copied or vendored source, exact version/commit, license, and SHA-256 in `third_party/SOURCE_REGISTRY.md`.
- Do not copy code, themes, prompts, or assets with no license, BUSL/source-available restrictions, no-white-label restrictions, or uncertain provenance.
- Apache-2.0 files keep their notices and headers. Copyleft or custom licenses require an explicit compatibility review.
- Do not copy from the research-only repositories listed in `LICENSE_POLICY.md` without a file-level decision.

### Publishing safety invariants

- AI may recommend review but cannot set `approved`.
- Only an approved article with zero linter ERRORs may reach a real draft adapter.
- Real draft actions require an explicit account alias, complete preview, safe credential provider, and confirmation of that exact operation.
- The browser must not receive AppSecret or access tokens.
- Logs, screenshots, reports, examples, Git history, and receipts must not contain secrets, cookies, complete credentials, or private content.
- MPForge v0.1 never performs formal broadcast or mass sending.

### Tests expected with changes

Add focused tests for changed behavior. State-machine, rendering, media, and publishing changes should cover invalid as well as successful paths. Important cases include repeated-render equality, all four themes, illegal transitions, AI approval denial, lint blocking, missing/deduplicated/SVG assets, external links, code/table/mobile layout, dark mode, Mock Draft, real missing-credential failure, receipt redaction, Git/hash consistency, and Windows paths.

## Verification

Run the narrowest tests while developing, then the release-relevant suite before requesting review:

```powershell
. .\scripts\env.ps1
.\scripts\pnpm.ps1 test
.\scripts\pnpm.ps1 lint
.\scripts\pnpm.ps1 build
git diff --check
```

When applicable, also run the Windows package build, browser end-to-end suite, deterministic preview capture, Mock Draft flow, secret scan, dependency-license check, public-example scan, and large-file check. Record exact commands, exit codes, commit SHA, and evidence paths; never infer success from the presence of a workflow file.

## Pull requests

- Keep the change focused and explain inherited versus new behavior.
- Update public docs and tests in the same change when behavior changes.
- Use `.github/PULL_REQUEST_TEMPLATE.md` and complete only checks you actually ran.
- Identify untested platforms, missing external access, or release blockers explicitly.
- Screenshots and demos must come from the named commit and use only public-safe example data.
- Do not include generated installers, caches, private receipts, or user assets in Git.

## Releases

Only a human release maintainer may authorize the public tag/Release after reviewing test, license, secret, large-file, screenshot, Pages, and Windows artifact evidence. Candidate workflows may create draft artifacts; they do not announce completion. Real WeChat credentials and formal publication remain user decisions.
