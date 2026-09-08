# `apps/server` license analysis

## Decision

`apps/server` is classified as `LICENSE_AMBIGUOUS` and is excluded under
**Scheme A: complete removal**. MPForge must not distribute this directory,
its compiled output, its uploaded files, or any Git object that exposes its
contents.

This is a conservative release-policy decision, not a claim about the legal
effect of either license notice. It follows the project's requirement to avoid
publishing code whose grant is not unambiguous.

## Evidence

- The repository root `LICENSE` is the WeMD Team MIT license. Its Git blob is
  identical to `LICENSE` at pinned upstream commit
  `964525d80ef63477c3a4b0327fe2a43415ee2bad`.
- At that pinned commit, `apps/server/package.json` declared both
  `private: true` and `license: UNLICENSED`.
- MPForge baseline commit `629c4701829e9b1f640f69dfe9b775b8bbed7e03`
  changed only the manifest license value from `UNLICENSED` to `MIT`. It did
  not independently implement the inherited server source and is not evidence
  of a separate written license grant.
- The inherited server first appears in upstream commit
  `1d29dc7e56710b130a6af42999d6c2cd2836f724`. Its objects remain reachable
  from the local development history and inherited tags.
- The audited server tree contained 26 tracked files, including three uploaded
  photographs with no public-release provenance record.

## Dependency conclusion

No workspace package declares `@wemd/server` as a dependency. The server is
pulled into repository-wide tasks only because the former workspace pattern
matched every directory under `apps/`. The Web image uploader has a generic
HTTP contract, but it does not import or link the server package. MPForge's
v0.1 core media pipeline, Mock WeChat service, and draft adapter do not require
this inherited server.

Therefore removal does not require a replacement service for v0.1. A future
server, if required, must be implemented from a clean behavioral specification
without copying this source.

## Required public-release treatment

1. Exclude `apps/server/**` from the public working tree and release staging.
2. Use an explicit workspace allowlist so a later `apps/server` directory
   cannot silently re-enter builds.
3. Remove the `apps/server` lockfile importer and regenerate dependency and
   license evidence.
4. Remove or relabel product and documentation claims that imply an included
   zero-configuration image-hosting server.
5. Create the public repository from a clean, allowlisted source export. Do not
   push local development branches, inherited tags, or local Git objects.
6. Scan the public history and every archive for `apps/server/` before tagging.

The local development history may retain the upstream history for provenance,
but it is not a publishable history and must not be connected to the public
release remote.

## Status

- Scheme selected: `A_REMOVE`
- Upstream attribution: `RETAINED`
- Public tree removal verification: `PASS`
- Public history verification: `PASS` in the clean public-source repository
- Post-removal test and build verification: `PASS`
- Source and runtime SBOM verification: `PASS`
- Windows release-artifact verification: `PASS`
- Release authorization: `LOCAL_GATES_PASS_ONLINE_GATES_PENDING`
