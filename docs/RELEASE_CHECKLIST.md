# MPForge release checklist

This checklist separates a safe local candidate from a public release. The user authorized a public v0.1.0 release for Round 4, but publication remains conditional on every gate below passing.

## Local candidate — complete

- [x] Build from fixed source commit `958c57bfb4f177af551e6b17ab7548b05eb27e4d`.
- [x] Keep all toolchains, dependencies, browser/Electron caches, sources, skills, temporary data, and artifacts inside the project-local boundary.
- [x] Set `MPFORGE_NETWORK_MODE=mock-only` and `MPFORGE_REAL_WECHAT_DISABLED=true`.
- [x] Pass full tests, type checking, repository QA, production build, frontend secret scan, and 27 Chromium E2E cases.
- [x] Build Windows x64 NSIS and ZIP with `--publish never`.
- [x] Verify SHA-256 and confirm Authenticode state is truthfully `NotSigned`.
- [x] Audit ASAR exclusions for MPForge source/tests, private server, article content, operation evidence, and environment files.
- [x] Install into an isolated repository-local directory, start the product, uninstall it, and verify shortcut cleanup.
- [x] Record evidence in `reports/round5-verification.md`, `reports/windows-build-v0.1.0.md`, and `artifacts/evidence/round-5/`.

## Public release — authorized but gate-protected

- [x] Resolve `apps/server` conservatively through Scheme A: remove it from the public source, dependency graph, build, clean public history, SBOM and artifacts.
- [ ] Decide whether Windows signing is required; if claiming a signed installer, provide and verify an approved signing identity without committing secrets.
- [ ] Configure and verify the intended public GitHub repository and upstream relationships.
- [ ] Keep candidate workflows non-publishing and permit the release workflow only after all blockers are closed.
- [ ] Create the exact reviewed tag and let the release workflow rebuild from that tag.
- [ ] Verify remote workflow results instead of treating workflow definitions as execution evidence.
- [ ] Compare every published byte size and SHA-256 against the tag-specific report.
- [ ] Verify the public Release page, download behavior, notices, changelog, and rollback path from a clean client.
- [ ] Only then update README/project state from “local candidate” to “published release.”

## Local rebuild command

```powershell
. .\scripts\env.ps1
$env:MPFORGE_NETWORK_MODE = 'mock-only'
$env:MPFORGE_REAL_WECHAT_DISABLED = 'true'
.\scripts\pnpm.ps1 test
.\scripts\pnpm.ps1 typecheck
.\scripts\pnpm.ps1 qa
.\scripts\pnpm.ps1 build
node .\scripts\check-frontend-bundle-secrets.mjs
.\scripts\pnpm.ps1 test:e2e
.\scripts\pnpm.ps1 --dir apps/electron exec electron-builder --win -c electron-builder.json --publish never
```

Do not replace `--publish never` in a candidate build. Public publication belongs only to the separately authorized workflow job. Real WeChat testing is a different side effect and is not authorized by this release checklist.
