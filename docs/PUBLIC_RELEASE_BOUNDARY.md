# Public release boundary

MPForge uses separate local-development and public-release trust boundaries.
The local repository preserves upstream history and local evidence. The public
repository is created from a clean, allowlisted source export and contains no
local Git objects or inherited tags.

## Allowed source families

Subject to successful provenance, secret, license, privacy, and artifact scans,
the public source may include:

- `apps/web`, `apps/electron`, `apps/cli`, `apps/mcp`, and
  `apps/mock-wechat`;
- required MPForge and inherited MIT packages under `packages/`;
- project-level skills under `.agents/skills`;
- original public examples, safe tests, documentation, release scripts, and
  GitHub workflows;
- `LICENSE`, `NOTICE.md`, `UPSTREAM.md`, `THIRD_PARTY_NOTICES.md`,
  `LICENSE_POLICY.md`, `SECURITY.md`, contribution files, public manifests,
  checksums, and SBOMs.

Inclusion in this list is not sufficient on its own. Every actual file must
also pass the release scans.

## Denied material

The public tree, history, Pages artifact, source archive, npm package, Windows
package, and any Docker context must reject:

- `apps/server/**` and `@wemd/server`;
- `.cache/**`, `tmp/**`, local logs, dumps, profiles, databases, and stores;
- `operations/**`, private article workspaces, real account configuration, and
  real or unresolved remote receipts;
- `.env` and `.env.*`, tokens, secrets, cookies, private keys, personal email or
  telephone data, and local absolute paths;
- `downloads/*.bundle`, downloaded binaries and source archives,
  `third_party/toolchains/**`, `third_party/sources/**`, Playwright browsers,
  Electron caches, Node archives, and package-manager stores;
- personal payment QR images, unverified uploaded photographs, and screenshots
  containing private data;
- unknown-license, `UNLICENSED`, Source Available, AGPL, or unresolved
  `NOASSERTION` material;
- unexpected large binaries and source maps that reveal denied paths or data.

Only the sanitized public download manifest is distributed. The local download
manifest and the downloads it inventories remain local.

## Public-history strategy

The selected strategy is `CLEAN_SOURCE_HISTORY`:

1. Build a staging tree strictly from the allowlist.
2. Run the boundary, secret, privacy, endpoint, license, and large-file scans
   against that staging tree.
3. Initialize a new Git repository in staging; never copy the development
   repository's `.git` directory.
4. Make an initial commit that says the project is based on WeMD, records the
   pinned commit, and explains why the public history was sanitized.
5. Attach the public remote only to the clean repository.
6. Before pushing or tagging, scan all reachable objects, refs, tags, and Git
   LFS entries.

The original development branches and inherited `v1.*` tags must not be pushed
to the public remote. Deleting a path only at the latest commit does not satisfy
this boundary.

## Artifact checks

Each release gate must inspect:

1. the staging file tree and Git index;
2. all reachable public Git objects and tags;
3. Git LFS entries;
4. Web output and source maps;
5. Electron ASAR, installer, and portable archive;
6. CLI and MCP package contents;
7. source archive and release ZIP listings;
8. Pages output;
9. Docker context, if published;
10. source and runtime SBOMs, checksums, and release manifest.

Any `ERROR` prevents creation of a public tag or Release.

## Status

- Boundary policy: `DEFINED`
- Clean public repository: `PENDING`
- Public history scan: `PENDING`
- Public artifact scan: `PENDING`
- Public release: `BLOCKED_UNTIL_ALL_GATES_PASS`
