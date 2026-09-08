# Round 4 public release verification

## Current release decision

`LOCAL_REGRESSION_PASSED_PUBLIC_EXPORT_PENDING`

The 2026-09-04 source, unit/integration/Web/E2E, Mock, installer, and boundary
checks passed locally. The 2026-09-08 pre-publication audit found that the
configured npm mirror has no security audit endpoint. Querying the official
npm registry returned 15 high and 3 critical production advisory findings in
the candidate dependency graph. Those results supersede the earlier broad
statement that every local release gate had passed.

The public repository has been created, but no source, tag, installer, or Release
has been uploaded at this checkpoint. The updated production graph passes the
official high-severity threshold (0 critical, 0 high, 1 disclosed moderate).
A separate shipped-runtime check then found the inherited Electron 28.3.3 had
7 high advisories. It is now pinned to supported Electron 44.2.0; the official
archive hash and executable version match, and its separate advisory query has
zero findings. Final packaged desktop revalidation has passed.
Advisory findings are not evidence of a successful exploit.

## September 8 regression checkpoint

- Lint and typecheck: passed (12 existing Web warnings, zero errors).
- Complete unit/integration suite: passed; Web includes 105 test files.
- Repository QA: passed, including secrets, licenses and forbidden capabilities.
- Full component build: 18 of 18 tasks passed with Demo environment in cache keys.
- Frontend secret scan and Demo endpoint exclusion: passed.
- Public boundary and metadata policy regression: 20 of 20 passed.
- Controlled-adapter browser suite: 27 of 27 passed.
- Public Demo isolation: 2 of 2 passed after correcting the test-selection command.
  The prior command accidentally ran backend-only scenarios in browser-only Demo;
  those failures are retained locally and the CI invocation is corrected.
- Final Windows installer and portable package: built with Electron 44.2.0,
  then portable startup, actual installation, installed startup and uninstall
  passed. Both application captures verified the executable's runtime version,
  zero external requests and zero visible privacy findings. Signing: unsigned.
  Earlier Electron 28 candidates are preserved locally and will not be released.
- Electron migration: 24 desktop tests passed, including asynchronous clipboard
  rejection and MIME-item regressions. Runtime-audit/bootstrap tests: 7 passed.
- Actual CLI dark previews now use independently rendered dark HTML and bind
  both modes into preview evidence. Preview tests: 7 passed; CLI tests: 17 passed.
- CLI compilation now has an explicit source root and excludes compiled tests,
  preventing stale entry files from masking incorrect nested output layouts.
- An isolated launch candidate has 0 lint errors and 10 warnings. Its 12-image
  preview matrix was regenerated through the built CLI; safe/WeChat mobile
  previews have no overflow, missing images, or page errors, and the four WeChat
  images have no contrast warnings. Human review and image rights remain pending.

## Corrections under verification

- Runtime audit explicitly queries the official npm security endpoint.
- Inherited unused vulnerable Markdown plugins are removed and the active
  dependency chains are upgraded to reviewed patched versions.
- Only privacy-reviewed Round 4 PNG/GIF evidence is admitted by Git ignore rules.
- Public source inventory and README assets are checked against tracked files.
- CI uses the same file-level SPDX and licensed CycloneDX generator as local
  builds; missing or unreviewed license conclusions fail closed.
- SPDX package verification uses SHA-1 of sorted file SHA-1 digests as specified
  by the [SPDX 2.3 package verification algorithm](https://spdx.github.io/spdx-spec/v2.3/package-information/#79-package-verification-code-field).

## Claim boundary

- Mock draft flow and real adapter contract tests have prior passing evidence.
- Live account: not tested.
- Formal publication and mass sending: unsupported.
- Windows artifacts: unsigned; supported-runtime candidates now pass local smoke
  verification. Final public Release hashes will come from the verified tag build.
- ChatGPT bridge: pending; no acknowledgment has been received.
- Launch copy is a draft; no human article approval is inferred from release
  authorization.
