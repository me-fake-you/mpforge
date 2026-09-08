# Server reimplementation notes

## v0.1 decision

MPForge v0.1 uses Scheme A: remove the inherited `apps/server` component.
No replacement server has been implemented, and none is required for the v0.1
core workflow.

The decision is supported by the dependency audit:

- no workspace package imports or declares `@wemd/server`;
- the server entered root tasks through workspace wildcard discovery only;
- the media pipeline operates locally;
- Mock draft uploads are provided by the isolated Mock WeChat service;
- the real adapter contract is separate from the inherited general image
  upload service;
- Docker, Pages, and desktop packaging do not require the server.

## User-facing image hosting

The inherited Web UI contained an "official" image-hosting option whose client
performed a generic HTTP upload to a configured base URL. That client-side
contract is not a dependency on, or authorization to copy, the inherited
server.

For the public product, this option must either be removed or presented as an
explicitly configured external self-hosted endpoint. MPForge must not advertise
an included, zero-configuration official hosting service when none is
distributed.

## Future clean-room rule

If a future release genuinely requires a server:

1. A provenance reviewer must prepare a behavioral specification using only
   public platform documentation, MPForge-owned types and tests, and observable
   behavior.
2. The implementer must not inspect or copy the inherited `apps/server` source,
   file layout, comments, or implementation details.
3. The new component must use a new path and package identity, carry an explicit
   MIT license, and have independent tests and a source record.
4. Compatibility must be demonstrated by public tests rather than source
   similarity.
5. Credential handling, network policy, upload limits, storage paths, and
   cleanup behavior must undergo a fresh security review.

No clean-room implementation is claimed in v0.1.

Post-removal regression status: `PENDING`.
