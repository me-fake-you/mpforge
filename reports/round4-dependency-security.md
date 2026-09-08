# Round 4 dependency security review

Audit date: 2026-09-08. Scopes: locked production dependency graph and a separate explicit shipped Electron runtime audit.

The official npm audit completed with **0 critical, 0 high, 1 moderate and 0 low** findings. The configured high-severity release gate passed with exit code 0. No advisory was ignored, muted or excepted. Passing this threshold does not mean that every dependency is free of known vulnerabilities.

```text
pnpm audit --prod --audit-level high --registry=https://registry.npmjs.org
node scripts/check-shipped-runtime.mjs
```

SHA-256 of the audited local `pnpm-lock.yaml` bytes:

```text
8636475fc4f9c3f100b2391a86279aec5271f40a83c08fb088818ae38bb7daa2
```

Git checkout line-ending conversion can change this file-byte hash; package versions and integrity records remain defined by the lockfile.

## Remediation

The earlier official audit reported 3 critical and 15 high findings. This update removes unused `markdown-it-katex` and upgrades the active CSS inliner from Juice 5.2.0 to 11.1.1, removing its `request`, `lodash.pick` and `image-size` dependency chains. It also updates the affected Markdown, diagram, XML, URL-linking and sanitization dependencies.

| Package                                | Audited locked version |
| -------------------------------------- | ---------------------- |
| juice                                  | 11.1.1                 |
| markdown-it                            | 14.3.1                 |
| mermaid                                | 11.17.2                |
| fast-xml-parser, compatible 4.x branch | 4.5.7                  |
| fast-xml-parser, 5.x branch            | 5.11.1                 |
| linkify-it                             | 5.0.2                  |
| dompurify                              | 3.4.15                 |
| uuid, 11.x branch                      | 11.1.1                 |

## Shipped desktop runtime

Electron is declared as a development dependency by the packaging toolchain but its executable is shipped to users. Consequently, `pnpm audit --prod` does **not** cover that runtime. The production counts above must not be used as an Electron security claim.

The old shipped version, 28.3.3, had 32 Electron advisories in the official npm response: 7 high, 20 moderate and 5 low. The runtime is now pinned to **44.2.0**, a supported stable release listed on the [official Electron releases page](https://releases.electronjs.org/?channel=stable). A separate exact-version query to the official npm advisory endpoint returns **0 Electron advisories** for 44.2.0. This is a dated advisory result, not a guarantee that no undisclosed issues exist or that Chromium advisories are exhaustively represented by npm.

The new `check-shipped-runtime.mjs` gate explicitly audits Electron independently of dependency classification, rejects a non-exact version or an installed-version mismatch, and fails closed on network or malformed-response errors. It fails for high/critical findings and reports all severities without exclusions. A failed query also replaces any old report with a failure result.

The downloaded official Windows x64 archive was verified against the checksum bundled with the installed Electron 44.2.0 npm package:

```text
electron-v44.2.0-win32-x64.zip
4021363e3090d67a144ebedb90765cf193b0e61f300c519c83f0174502a481da
```

The installed executable reports Electron 44.2.0, Chromium 152.0.7977.76 and Node.js 24.20.0. The [Electron clipboard migration](https://www.electronjs.org/docs/latest/api/clipboard) is implemented using MIME-keyed `ClipboardItem` objects and awaiting native writes before returning success. Installer and application-wide smoke results are tracked separately.

## Remaining moderate advisory

[GHSA-gh4j-gqv2-49f6](https://github.com/advisories/GHSA-gh4j-gqv2-49f6) concerns XML comment and CDATA delimiter injection in `fast-xml-parser`'s XMLBuilder. The reported production path is:

```text
apps/web → cos-js-sdk-v5@1.10.1 → fast-xml-parser@4.5.7
```

The advisory's patched range starts at 5.7.0. The current upstream COS SDK version, 1.10.1, pins parser 4.5.0; MPForge uses a compatible override to 4.5.7. An unverified major-version parser substitution was not introduced.

The inspected COS SDK constructs `XMLBuilder` with default options and does not enable `commentPropName` or `cdataPropName`. This limits the observed application path to the reported injection behavior, but is not proof that the dependency is universally non-exploitable. The finding remains open and visible in audit output.

The default public Demo uses local Mock fixtures and does not configure or call COS. The optional Tencent COS uploader remains a separate capability requiring user configuration; the Demo's scope must not be generalized to configured COS usage. A compatible upstream fix or separately verified migration is still needed to eliminate this advisory.

## Verification

- Core suite: 65 of 65 tests passed across 9 files.
- Core TypeScript check: passed.
- Actual CSS inlining tests cover important declarations, pseudo-element content, code indentation and copy-safe inline styles.
- The remote-resource inlining regression observed zero `fetch`, `http.request` and `https.request` calls.
- Production audit against the official npm registry: passed at the unchanged high-severity threshold.
- Shipped Electron exact-version audit: passed, 0 advisories; audit gate fixture tests: 5 of 5 passed.
- Desktop TypeScript compilation and tests: 24 of 24 passed, including MIME item content and delayed native rejection for both clipboard routes.
- Offline frozen-lockfile installation: passed after updating the minimum Node.js version to 22.12.0.

These are dependency-remediation checks, not evidence of live WeChat account testing or complete application verification. Release-wide checks are recorded separately.
