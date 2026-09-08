# MPForge v0.1.0 GitHub Release post

> `RELEASE NOTES READY` — publish only from the verified `v0.1.0` tag after all automated gates pass.

## MPForge v0.1.0

MPForge is a Git-driven, agent-friendly Content-as-Code workbench for preparing WeChat Official Account drafts:

```text
Markdown → lint → media review → previews → human approval
         → Mock or guarded Real Draft → redacted receipt
```

### What this candidate adds

- structured article state and auditable events;
- deterministic lint and rendering evidence;
- local media provenance and rights gates;
- light, dark, mobile, safe, source, and WeChat-oriented previews;
- human-only approval;
- Mock WeChat execution, idempotency, uncertain-state handling, and reconciliation;
- guarded Real Draft contract, CLI, MCP, and project-level Skills;
- Windows installer and portable package workflows with SHA-256 evidence.

### Mock and Real are not the same claim

The public Demo uses Mock WeChat only and makes no real WeChat request. Real Draft requires the user's own eligible account configuration and an explicit confirmation for the exact operation. Live-account behavior has **not been tested** for v0.1.0.

MPForge does not automate formal publication or mass sending. A human remains responsible for final publication in the WeChat admin console.

### Upstream and license

MPForge is **Based on WeMD by the WeMD Team** and retains the WeMD MIT license, copyright, and pinned upstream attribution. It is not affiliated with Tencent or WeChat.

The public source omits the inherited `apps/server` component because its upstream component metadata declared `UNLICENSED`. The sanitized history and release artifacts also omit personal payment QR images, unverified uploaded photographs, local bundles, caches, toolchains, private content, and real receipts.

### Downloads

- Public repository: https://github.com/me-fake-you/mpforge
- Release page: https://github.com/me-fake-you/mpforge/releases/tag/v0.1.0
- Windows installer: https://github.com/me-fake-you/mpforge/releases/download/v0.1.0/MPForge.Setup.0.1.0.exe
- Windows portable ZIP: https://github.com/me-fake-you/mpforge/releases/download/v0.1.0/MPForge-Portable-0.1.0-win-x64.zip
- SHA-256 checksums: https://github.com/me-fake-you/mpforge/releases/download/v0.1.0/SHA256SUMS
- Source SBOM: https://github.com/me-fake-you/mpforge/releases/download/v0.1.0/sbom-source.spdx.json
- Runtime SBOM: https://github.com/me-fake-you/mpforge/releases/download/v0.1.0/sbom-runtime.cdx.json
- Mock Pages Demo: https://me-fake-you.github.io/mpforge/

### Known limitations

- Live-account draft creation is untested.
- There is no automatic formal publication or mass-send function.
- The public Web Demo exposes only browser-safe Mock capabilities; desktop-only features are labeled accordingly.
- Windows signing status: **unsigned**. Windows may show an operating-system warning; verify `SHA256SUMS` before running the package.
- The shipped desktop runtime is pinned to Electron 44.2.0 and separately audited because `pnpm audit --prod` excludes its development-dependency declaration. The exact-version official npm audit reports 0 Electron advisories on 2026-09-08; the replaced 28.3.3 runtime had 7 high findings. These dated results are not a guarantee of undisclosed-vulnerability absence or complete Chromium advisory coverage.
- The 2026-09-08 official npm production audit has 0 critical, 0 high and 1 moderate finding, with no ignored advisories. The remaining [XMLBuilder advisory](https://github.com/advisories/GHSA-gh4j-gqv2-49f6) affects the optional COS SDK dependency path through `fast-xml-parser@4.5.7`. The inspected SDK uses default builder options without comment/CDATA configuration; this is limited scope evidence, not proof of non-exploitability. The default Mock Demo does not configure or call COS. See the [dependency security review](https://github.com/me-fake-you/mpforge/blob/v0.1.0/reports/round4-dependency-security.md) for details.

The Release workflow generates final artifact hashes, SBOMs, provenance, and the manifest from the exact verified tag.
