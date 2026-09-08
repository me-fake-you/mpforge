# Round 2 threat model

## Assets and network boundary

- Path traversal and symlink escape could read or copy data outside the
  workspace. Resolve both lexical and real paths and fail closed.
- Remote images can target loopback, private/link-local ranges, DNS rebinding or
  cloud metadata. Import is explicit, protocol constrained, DNS/IP checked per
  hop, redirect/timeout/byte limited and MIME verified.
- Images can be malformed, MIME disguised, decompression bombs or huge pixel
  surfaces. Parse bounded headers before decoding and reject unsafe dimensions,
  pixel count and byte size.
- SVG can execute scripts or load external content. Active elements,
  event attributes, foreign objects and external/JavaScript/data references are
  blocked. Originals are not modified.
- EXIF can expose GPS, device identifiers or local paths. Detect it on originals
  and remove private fields only from derived publish images.

## Article and HTML boundary

- Markdown/Frontmatter can contain local paths, unresolved placeholders,
  secrets, active HTML, malicious URLs or CSS intended to escape the mobile
  layout. Deterministic lint reports the source location and blocks ERRORs.
- Sanitization can remove meaningful content. Raw, safe and downgraded stages
  remain separately inspectable and are hash bound.
- Reports can become stale or be edited. Approval recomputes evidence hashes and
  rejects a mismatch instead of trusting the report's summary.

## Human authorization boundary

- An automation can impersonate a reviewer by setting article status. Status
  alone is ignored; production approval requires an interactive human actor,
  current hash confirmation, a completed checklist and an append-only record.
- Agent, Skill, MCP and CI paths have no approval primitive. They can request
  review only.
- Source/build/theme/assets/rules changes after approval invalidate the binding
  and append an invalidation record. A stale approval cannot authorize a draft.
- Approval logs can be modified. Records are canonicalized and hash chained;
  verification fails at the first broken link.

## Secrets and external side effects

Reports and logs must identify the rule/location without echoing a complete
token, password, cookie or AppSecret. Fixtures use unmistakably fake values.

Round 2 never requests credentials, calls a real WeChat API, creates a real
draft, broadcasts, uploads private articles, or downloads an unconfirmed image.
