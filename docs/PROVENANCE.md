# Provenance

MPForge is a transparent fork of WeMD, not a wholly original project. This
document classifies the material intended for the public source distribution.

## Fork base

- Upstream: <https://github.com/tenngoxars/WeMD>
- Pinned commit: `964525d80ef63477c3a4b0327fe2a43415ee2bad`
- Upstream license: MIT, copyright 2025 WeMD Team
- Local development history: retained for provenance, never pushed as the
  sanitized public history

## Source families

| Path or family                                                                                                                                                                   | Origin                                                                                     | Modified by MPForge   | Public status                              | Evidence                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------- | ------------------------------------------ | ------------------------------------------------------------------------------ |
| `apps/web`                                                                                                                                                                       | WeMD fork base plus MPForge changes                                                        | Yes                   | Include after boundary scan                | Git history, upstream pin, root MIT license                                    |
| `apps/electron`                                                                                                                                                                  | WeMD fork base plus MPForge changes                                                        | Yes                   | Include after boundary scan                | Git history, upstream pin, root MIT license                                    |
| `packages/core`                                                                                                                                                                  | WeMD fork base plus MPForge changes                                                        | Yes                   | Include after boundary scan                | Git history, upstream pin, root MIT license                                    |
| `apps/cli`, `apps/mcp`, `apps/mock-wechat`                                                                                                                                       | MPForge additions                                                                          | Yes                   | Include                                    | MPForge commits and MIT manifests                                              |
| `packages/audit`, `content-schema`, `content-store`, `draft-operations`, `linter`, `media`, `preview`, `renderer`, `review-gate`, `side-effect-gate`, `themes`, `wechat-adapter` | MPForge additions                                                                          | Yes                   | Include                                    | MPForge commits and MIT manifests                                              |
| `.agents/skills`                                                                                                                                                                 | MPForge additions                                                                          | Yes                   | Include                                    | MPForge commits; no research-only prompt or skill copied                       |
| `packages/themes`                                                                                                                                                                | Original MPForge themes and fixtures                                                       | Yes                   | Include                                    | MPForge commits and theme metadata                                             |
| `packages/core/src/themes`                                                                                                                                                       | Inherited WeMD themes                                                                      | Some                  | Include                                    | Upstream history and root MIT license; do not label as original MPForge themes |
| `scripts` and tests                                                                                                                                                              | Primarily MPForge release and verification work, with any inherited files traceable in Git | Yes                   | Include after scan                         | Git history and root MIT license                                               |
| `examples`                                                                                                                                                                       | MPForge example material                                                                   | Yes                   | Include only registered, original fixtures | Embedded/source metadata and review records                                    |
| `apps/server`                                                                                                                                                                    | Inherited WeMD component with conflicting license metadata                                 | No clean-room rewrite | Exclude                                    | Upstream manifest says `UNLICENSED`                                            |

## Third-party assets and libraries

- MathJax 3.2.2 is retained for offline math rendering under Apache-2.0.
- Mermaid, markdown-it, Highlight.js, storage SDKs, Lucide, Electron, and their
  transitive dependencies are tracked through the lockfile, notices, and final
  runtime SBOM.
- Maple Mono, JetBrains Mono, and Space Grotesk are local Web fonts under
  OFL-1.1. Their license files remain adjacent to the distributed fonts.
- The inherited dark-mode algorithm is attributed to `wechatjs/mp-darkmode`
  under MIT.
- Inherited application and PWA icons are recorded as WeMD fork assets. Any
  replacement icon must be registered as original MPForge material before
  release.

Exact source pins and known hashes are maintained in
`third_party/SOURCE_REGISTRY.md` and `downloads/MANIFEST.public.json`. Registry
dependencies are enumerated in the source and runtime SBOMs.

## Excluded material

The public distribution does not contain:

- the inherited `apps/server` source, tests, sample uploads, or history;
- personal payment QR images or their reachable Git objects;
- the local upstream Git bundle;
- downloaded toolchain archives, browser binaries, package caches, Electron
  caches, or third-party source checkouts;
- private content, account configuration, local operation ledgers, real
  receipts, cookies, tokens, secrets, or local absolute paths.

The former server upload samples include identifiable event photographs and
have no public-release rights record. Their exclusion is required independently
of the server code's license status.

## Generated public media

Public screenshots, preview images, and demo media must be generated from
project-owned fixtures in Mock mode. Their generation record must identify the
fixture, source commit, tool, and privacy scan result. Local Round evidence is
not automatically public merely because it is tracked in the development
repository.

## Updating provenance

Every newly copied source, theme, font, icon, image, prompt, skill, or script
must record its source, pinned version or commit, license, copyright, hash when
applicable, modification status, distribution status, and required notice
before it can enter the public allowlist.

Final clean-source and SBOM verification status: `PENDING`.
