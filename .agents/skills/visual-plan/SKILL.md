---
name: visual-plan
description: Plan article visuals with purpose, placement, alt text, dimensions, rights, and local asset destinations.
---

# Visual plan

For each proposed visual, record its narrative purpose, article position, suggested dimensions, alt text, source or generation plan, and rights status. Prefer assets the user owns or explicitly commissions. Keep network imports opt-in and rights-confirmed; place imported files under the article assets directory and let the media contract hash and validate them.

Do not download or reuse copyright-unclear media, remove watermarks, invent an
image URL, or put credentials in metadata. A network asset requires an explicit
user-authorized `mpforge assets import` operation. Keep `rights_status` pending
until a human provides evidence; this skill cannot promote it to approved. Run
`mpforge assets scan <article>` and `mpforge lint <article>` to catch missing,
unsafe, or unregistered references.
