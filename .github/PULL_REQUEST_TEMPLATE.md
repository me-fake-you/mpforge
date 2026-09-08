## Outcome

Describe the user-visible outcome and the smallest evidence that demonstrates it.

## Scope and provenance

- [ ] The change is scoped to MPForge and does not modify an unrelated project.
- [ ] New or copied third-party material is pinned and registered, or no third-party material was added.
- [ ] WeMD attribution, upstream history, and the MIT license remain intact.
- [ ] Public examples and screenshots contain only material we have the right to publish.
- [ ] Public-source history and release artifacts exclude `apps/server`, caches, toolchains, bundles, private content, and operation receipts.

## Safety boundaries

- [ ] AI cannot set an article to `approved`.
- [ ] Linter ERRORs still block draft creation.
- [ ] Real draft writes require an explicit account alias and exact user confirmation.
- [ ] No AppSecret, token, cookie, complete credential, private article, or private user path is logged or committed.
- [ ] This change does not add automatic formal broadcast or mass sending.
- [ ] CI, Pages, and release validation remain locked to Mock-only mode and use no real WeChat credentials.

## Verification

List exact commands, commit SHA, exit status, and artifact/report paths. Do not write “all tests pass” without evidence.

- [ ] Relevant unit/integration tests
- [ ] Lint and type checks
- [ ] Web build
- [ ] Windows build when desktop/release code changed
- [ ] Deterministic light/dark/mobile preview when renderer/theme code changed
- [ ] Mock Draft and redacted receipt when publish code changed
- [ ] Secret, license, large-file, and public-example review when release material changed
- [ ] Public boundary, Git history, artifact, and forbidden-endpoint scans when public files or workflows changed
- [ ] Pages bundle visibly identifies DEMO / MOCK and contains no callable external API endpoint

## Remaining limits

State anything not tested, deployed, published, or supported by this pull request.

Do not equate Mock success with a live account test, formal publication, or mass-send support.
