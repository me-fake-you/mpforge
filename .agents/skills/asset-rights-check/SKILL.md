---
name: asset-rights-check
description: Audit MPForge article images for source, creator, license, attribution, privacy metadata, and rights status without acquiring or approving media.
---

# Asset rights check

Run `mpforge assets scan <article>`, `mpforge assets inspect <article>`, and
`mpforge assets verify <article>`. For every referenced image, reconcile the
local path and SHA-256 with its original reference, source type/URL, creator,
license, attribution requirement, transformations, privacy warnings, and
`rights_status` in `assets/manifest.json`.

Treat missing provenance or an uncertain license as pending, and a known
prohibition as blocked. Do not silently download remote media, remove a
watermark, invent attribution, infer ownership from possession, or change
unknown/pending media to approved. A user-owned or generated image still needs
an explicit human confirmation and truthful source/tool record. Report exactly
which fields or evidence a human must supply; this skill cannot approve an
article.
