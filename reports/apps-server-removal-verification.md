# `apps/server` removal verification

## Current state

Scheme A removal is complete for the v0.1 public release boundary. The source
manifest and directory are absent, the workspace uses an explicit application
allowlist, and the lockfile has no `apps/server` importer. The clean public
source repository, Web build, Windows installer, portable ZIP, nested ASAR,
source SBOM, and runtime SBOM were scanned without finding the component.

The local development Git object database intentionally retains inherited WeMD
history for provenance and is never pushed to the public remote. The public
repository is created from the scanned allowlisted source export with new,
sanitized history.

## Required verification matrix

| Gate                | Required evidence                                               | Current status |
| ------------------- | --------------------------------------------------------------- | -------------- |
| Public working tree | No path beginning `apps/server/`                                | `PASS`         |
| Git tracked files   | `git ls-files` has no `apps/server/` entry                      | `PASS`         |
| Workspace graph     | Explicit app allowlist; no `@wemd/server` package               | `PASS`         |
| Lockfile            | No `apps/server` importer and no server-only dependency residue | `PASS`         |
| Imports             | No source or test imports `@wemd/server`                        | `PASS`         |
| Product behavior    | No claim that a bundled official image server exists            | `PASS`         |
| Docker context      | Server path denied and absent from copied context               | `PASS`         |
| CI and release      | Root tasks run successfully without the server workspace        | `PASS`         |
| Public history      | No reachable object path begins `apps/server/`                  | `PASS`         |
| Public tags         | No inherited tag exposing the server is pushed                  | `PASS`         |
| Source archive      | GitHub-generated tag archive scan                               | `ONLINE_GATE`  |
| Web build           | No server source, source map, or bundled endpoint dependency    | `PASS`         |
| Desktop packages    | Installer and portable archive contain no server path           | `PASS`         |
| SBOM                | Source and runtime SBOMs contain no `@wemd/server` component    | `PASS`         |
| License evidence    | Generated SBOMs have no unresolved license item                 | `PASS`         |
| Full regression     | Lint, typecheck, unit, integration, E2E, Mock and builds        | `PASS`         |

## History treatment

Deleting the directory at the tip is insufficient because the local
development history and inherited tags still reach its blobs. The selected
public-history strategy is a clean source repository created only from the
approved release staging tree. Its initial commit must preserve the WeMD name,
MIT notice, upstream URL, and pinned commit while explaining that the public
history was sanitized.

The original local repository remains a provenance source and must not be
pushed to the public release remote.

## Excluded adjacent material

- The three former upload samples under the server tree have unverified rights
  and are not distributed.
- Personal payment QR images are not part of the public source or history.
- The upstream Git bundle, downloaded archives, package caches, browser
  binaries, Electron caches, and toolchains remain local and are not released.

## Claim boundary

Current accurate status:

`LICENSE_BLOCKER_RESOLVED`

The GitHub-generated source archive remains an online release gate and will be
scanned after the public repository exists and before the v0.1.0 Release is
created.
