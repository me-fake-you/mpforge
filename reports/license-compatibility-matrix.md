# License compatibility matrix

This matrix records the public-release decision for source and runtime
components known at the audited v0.1 candidate. The generated source SPDX and
runtime CycloneDX SBOMs are the final evidence of record. The final locked graph
is regenerated after the security update; unreviewed or missing license
conclusions block generation. No unresolved, `NOASSERTION`, `UNLICENSED`, Source
Available, AGPL, or inherited `@wemd/server` component may be distributed.

| Component                                               | Evidence or selected license                                                  | Use                                          | Public decision   | Conditions                                                     |
| ------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------- | ----------------- | -------------------------------------------------------------- |
| WeMD source base                                        | MIT; root `LICENSE`; pinned commit `964525d80ef63477c3a4b0327fe2a43415ee2bad` | Fork base                                    | Include           | Preserve copyright, license and attribution                    |
| MPForge additions                                       | MIT in workspace manifests and root license policy                            | Product additions                            | Include           | Record modifications in `NOTICE.md`                            |
| Inherited `apps/server`                                 | `UNLICENSED` in its manifest at the upstream pin                              | Optional legacy upload service               | Exclude           | Remove from public tree, history, lockfile, SBOM and artifacts |
| `wechatjs/mp-darkmode` algorithm provenance             | MIT                                                                           | Dark preview behavior inherited through WeMD | Include           | Retain attribution                                             |
| MathJax 3.2.2                                           | Apache-2.0                                                                    | Offline math rendering                       | Include           | Ship Apache-2.0 text and notices                               |
| Mermaid 11.17.2                                         | MIT                                                                           | Diagrams                                     | Include           | Confirmed in runtime SBOM                                      |
| DOMPurify 3.4.15                                        | `(MPL-2.0 OR Apache-2.0)`; Apache-2.0 selected                                | Mermaid dependency                           | Include           | Record selected Apache option                                  |
| Highlight.js 11.11.1                                    | BSD-3-Clause                                                                  | Code highlighting                            | Include           | Retain license text through dependency notices                 |
| markdown-it family                                      | Primarily MIT; task-list plugin ISC                                           | Markdown rendering                           | Include           | Complete graph confirmed in runtime SBOM                       |
| Qiniu JavaScript SDK                                    | MIT                                                                           | Optional image storage integration           | Include           | No user credentials in source or artifacts                     |
| Tencent COS browser SDK                                 | ISC                                                                           | Optional image storage integration           | Include           | No user credentials in source or artifacts                     |
| Tencent COS Node SDK formerly reachable from server     | ISC                                                                           | Legacy server dependency                     | Exclude           | Not reachable after server removal                             |
| AWS/S3 client dependencies                              | Apache-2.0 and compatible permissive dependencies                             | Optional S3 integration                      | Include           | Exact runtime graph confirmed in SBOM                          |
| Lucide React / Feather portions                         | ISC / MIT                                                                     | UI icons                                     | Include           | Preserve notices                                               |
| Electron                                                | MIT plus Chromium third-party notices                                         | Desktop runtime                              | Include           | Preserve generated Chromium license bundle                     |
| Maple Mono                                              | OFL-1.1                                                                       | Local UI font                                | Include           | Retain font license and Reserved Font Name terms               |
| JetBrains Mono                                          | OFL-1.1                                                                       | Local UI font                                | Include           | Retain `OFL.txt`                                               |
| Space Grotesk                                           | OFL-1.1                                                                       | Local UI font                                | Include           | Retain `OFL.txt`                                               |
| `argparse@2.0.1`                                        | Python-2.0                                                                    | Transitive runtime dependency                | Include           | Preserved in runtime SBOM                                      |
| `css-select@1.2.0`                                      | Metadata says BSD-like; file review concluded BSD-2-Clause                    | Transitive runtime dependency                | Include           | Reviewed conclusion recorded in runtime SBOM                   |
| `domutils@1.5.1`                                        | Metadata unknown; local license file concluded BSD-2-Clause                   | Transitive runtime dependency                | Include           | Reviewed conclusion recorded in runtime SBOM                   |
| `khroma@2.1.0`                                          | Metadata unknown; local license file concluded MIT                            | Transitive runtime dependency                | Include           | Reviewed conclusion recorded in runtime SBOM                   |
| `json-schema@0.4.0`                                     | `(AFL-2.1 OR BSD-3-Clause)`; BSD-3-Clause selected                            | Transitive runtime dependency                | Include           | Selected BSD option recorded in runtime SBOM                   |
| `spark-md5@3.0.2`                                       | `(WTFPL OR MIT)`; MIT selected                                                | Transitive runtime dependency                | Include           | Record selected MIT option                                     |
| `slick@1.12.2`                                          | URL-qualified MIT metadata                                                    | Transitive runtime dependency                | Include           | Normalize conclusion to MIT with evidence                      |
| `robust-predicates@3.0.2`                               | Unlicense                                                                     | Transitive runtime dependency                | Include           | Preserved in runtime SBOM                                      |
| `tweetnacl@0.14.5`                                      | Unlicense                                                                     | Transitive runtime dependency                | Include           | Preserved in runtime SBOM                                      |
| `tslib@2.8.1`                                           | 0BSD                                                                          | Shared runtime helper                        | Include           | Reachability confirmed after server removal                    |
| Personal payment QR assets                              | No public-release authorization; personal identifiers                         | Legacy funding media                         | Exclude           | Remove from tree and public history                            |
| Uploaded event photographs                              | Rights and subject authorization unverified                                   | Legacy server samples                        | Exclude           | Remove from tree and public history                            |
| Local toolchains, caches and downloaded archives        | Their own upstream licenses; build inputs only                                | Development tooling                          | Do not distribute | Publish metadata only in the public download manifest          |
| Research-only repositories named in `LICENSE_POLICY.md` | Not incorporated                                                              | Research references                          | Exclude           | File-level review required before future reuse                 |

## Global release rules

### 2026-09-08 file-level correction: tiny-oss

`tiny-oss@0.5.1` is **excluded**. Its package manifest declares MIT and includes `vendor` in its published files, but the complete `vendor/digest.js:1-20` license block declares GPL-3.0-or-later for that file (copyright 2011–2012, 2014 Jean-Christophe Sirot). The digest implementation was present in the generated Aliyun uploader bundle. The outer package label therefore does not support distributing that bundle under the project's permissive-only release policy.

The dependency and its exclusively reachable graph have been removed from the development manifest and lockfile. The release metadata policy now blocks `tiny-oss` before evaluating a package-level license; tests cover versioned generator identities, plain verifier names and package URLs. The updated verifier rejects the earlier candidate SBOM even though it recorded MIT for this component. This deliberately invalidates the previous candidate's license clearance.

Dependency remediation and policy tests: `PASS`. Final source/runtime SBOM and rebuilt Web/Windows artifact reconciliation: `PENDING_REBUILD_AFTER_TINY_OSS_REMOVAL`. No earlier binary or SBOM may be reused as license-cleared release evidence.

- GPL, LGPL, AGPL, Source Available, `NOASSERTION`, `UNLICENSED`, custom
  restrictions, or unresolved no-license material block release unless the
  component is demonstrably external and not distributed.
- A package-manager license label alone is not sufficient when source-level
  evidence conflicts with it.
- `Unknown` is acceptable only as raw package metadata when a retained license
  file supports a documented SPDX conclusion.
- Reconcile this matrix with regenerated SBOMs and rebuilt artifacts after the
  tiny-oss removal; package-level labels alone did not detect the bundled GPL file.

Current final-SBOM reconciliation status: `PENDING_REBUILD_AFTER_TINY_OSS_REMOVAL`.
