# Secure media pipeline

Round 2 treats every article image as untrusted input and every optimized image
as a derived build artifact. Scanning and rendering never perform network
downloads.

## Storage contract

```text
content/<slug>/
  assets/
    originals/          # immutable imported bytes
    manifest.json       # provenance, safety, rights and transformation records
  build/
    assets/             # derived publish candidates
```

An explicit import validates the source before writing anything. Local paths
must remain inside the article/project boundary after symlink resolution.
Remote imports accept only HTTP(S), resolve and reject loopback, private,
link-local and cloud-metadata destinations, limit redirects, response time and
bytes, and verify the detected MIME type after download. A scan only reports a
remote reference; it never imports it.

Original bytes are copied once under `assets/originals` and never overwritten
or deleted by optimization. SHA-256 identifies duplicates. Name collisions use
a new deterministic destination rather than replacing an existing file.

## Inspection and transformation

PNG, JPEG, WebP, GIF and SVG are identified from bytes rather than extension
alone. Inspection records size, dimensions, animation/alpha capability, EXIF
and GPS indicators, and rejects malformed input, MIME masquerading, unsafe SVG,
excessive compressed size, excessive dimensions and excessive pixel count.

Derived builds may remove GPS, device identifiers, absolute paths and
non-essential private EXIF. Transformations are recorded with input/output
hashes and sizes. Small images are not enlarged. A failed conversion preserves
the original and reports an error.

SVG is parsed conservatively. Scripts, event handlers, external references,
foreign objects, JavaScript/data URLs and other active content block the asset;
sanitization or rasterization must never silently alter the original.

## Rights gate

Every manifest entry uses one source type (`local`, `remote`, `generated`,
`user_owned`, `project_asset`) and one rights state (`approved`, `pending`,
`blocked`, `unknown`). Preview may display unresolved assets with a warning, but
approval requires every referenced asset to be `approved`. Attribution required
by a license must be present. Possession of a file is not proof of ownership,
and an automation cannot promote an unresolved rights state.

No pipeline operation removes watermarks, fabricates provenance, or contacts a
real WeChat endpoint.
