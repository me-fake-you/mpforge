# Third-party notices

MPForge is forked from [tenngoxars/WeMD](https://github.com/tenngoxars/WeMD) at commit `964525d80ef63477c3a4b0327fe2a43415ee2bad`. Copyright (c) 2025 WeMD Team; MIT License retained in `LICENSE`.

The inherited dark-mode preview implementation is based on the core algorithm of [wechatjs/mp-darkmode](https://github.com/wechatjs/mp-darkmode), copyright 2020 Wechat.js, MIT License.

## Bundled runtime libraries

- MathJax 3.2.2, including `apps/web/public/libs/mathjax/tex-svg.js`: Apache-2.0.
- Mermaid 11.17.2: MIT.
- DOMPurify 3.4.15, reached through Mermaid: Apache-2.0 option selected from `(MPL-2.0 OR Apache-2.0)`.
- Juice 11.1.1: MIT. The vulnerable inherited 5.2 dependency chain is excluded.
- Highlight.js 11.11.1: BSD-3-Clause.
- markdown-it and plugins: primarily MIT; `markdown-it-task-lists` is ISC.
- Qiniu JavaScript SDK and spark-md5: MIT option selected for spark-md5.
- Tencent COS browser SDK: ISC. The former server's Node SDK is excluded.
- Lucide React 0.555.0: ISC, with portions derived from Feather Icons under MIT. Round 1 reuses this existing dependency for local UI icons.
- Electron: MIT. Desktop artifacts preserve Electron's generated `LICENSES.chromium.html` notices.

The Apache-2.0 text used by MathJax and the selected DOMPurify option is included at `third_party/licenses/Apache-2.0.txt`.

## Fonts

- Maple Mono: OFL-1.1, copyright 2022 subframe7536, Reserved Font Name Maple Mono. See `apps/web/public/fonts/maple-mono/LICENSE`.
- JetBrains Mono: OFL-1.1, copyright 2020 The JetBrains Mono Project Authors. See `apps/web/public/fonts/jetbrains-mono/OFL.txt`.
- Space Grotesk: OFL-1.1, copyright 2020 The Space Grotesk Project Authors. See `apps/web/public/fonts/space-grotesk/OFL.txt`.

## Provenance resolution

Upstream provider-logo WebP files had no source or license metadata. MPForge removed those binaries and uses neutral text marks, so no undocumented provider trademark image is redistributed.

Round 1 themes, preview fixtures, example prose, and the SVG files under `examples/technical-article`, `examples/education-article`, and `examples/editorial-article` are original MPForge material. Their Frontmatter records AI assistance truthfully, and each SVG embeds MIT provenance metadata. No third-party theme was copied.

The fork inherited a Qiniu token helper comment that referenced `doocs/md` without an exact source pin. Round 1 removed that handwritten helper and now uses the already-declared CryptoJS UTF-8/Base64 implementation, so MPForge does not redistribute the unpinned helper.

Exact current production dependency evidence is published in `release/sbom-runtime.cdx.json`, with source files in `release/sbom-source.spdx.json`. Downloaded-source and hash evidence is maintained in `third_party/SOURCE_REGISTRY.md` and `downloads/MANIFEST.public.json`; downloaded payloads remain local.

## Round 2 additions

Round 2 introduces no new registry package version and copies no code, prompt, skill, theme, font, or media from the research-only repositories listed in `LICENSE_POLICY.md`. The linter, media pipeline, review gate, preview code, project skills, fixtures, and generated screenshots are original MPForge work built on dependencies already present in the pinned workspace lockfile. Test asset rights and generation provenance are recorded locally; no unknown-rights image is represented as publication-ready.

## Round 3 release audit

The three Round 3 core workspace packages—`@mpforge/wechat-adapter`, `@mpforge/draft-operations`, and `@mpforge/side-effect-gate`—are private MIT packages with no production dependencies. Their pnpm-lock importers are present and aligned at `packages/wechat-adapter`, `packages/draft-operations`, and `packages/side-effect-gate`. The previous-round `content-store`, `preview`, and `review-gate` packages remain private MIT but are not counted as the three Round 3 additions. The Mock WeChat app, CLI, MCP app, Electron shell, and web UI manifests are MIT; their corresponding pnpm-lock importers are present and aligned, including `apps/electron` -> the narrow `@mpforge/cli/accounts` and `@mpforge/cli/drafts` exports plus `@mpforge/media`, and `apps/cli` -> `@mpforge/preview`/`@mpforge/review-gate`. No Round 3 package adds GPL, LGPL, AGPL, or a new registry source.

The earlier Round 3 dependency snapshot is retained locally as historical audit evidence. Round 4 regenerates the runtime SBOM from the final installed, locked graph and includes Electron when Windows artifacts are built. Reviewed dual-license choices and retained license-file conclusions are enforced by the shared release metadata policy; missing or unreviewed conclusions stop generation. DOMPurify is distributed under the selected Apache-2.0 option. The unused `markdown-it-katex` package and the old Juice dependency chain have been removed during security hardening.

The inherited `apps/server` component declared `UNLICENSED` at the pinned WeMD commit. A later manifest-only change to `MIT` was not accepted as proof of relicensing. MPForge therefore uses the conservative Scheme A resolution: the component, its sample uploads, its lockfile importer, and every reachable historical object containing it are excluded from the public source repository and release artifacts. MPForge v0.1.0 does not depend on or distribute that component.

The public repository is created as a clean, allowlisted source history. This preserves the WeMD name, upstream URL, pinned commit, original MIT notice, and modification provenance without publishing ambiguous or private inherited objects from the local development history.

The Round 3 release-ready SVG and derived PNG are project-generated and covered by the asset manifest, content-addressed original, deterministic transformation record, and the latest human approval event. The earlier approval was invalidated when the lint evidence changed; the latest approval binds the current manifest and lint hashes. This is evidence for the named local fixture, not an agent-granted legal-rights opinion.

Windows pnpm junctions under local `node_modules` are installation links only. They are not product assets and do not add a product-license obligation.
