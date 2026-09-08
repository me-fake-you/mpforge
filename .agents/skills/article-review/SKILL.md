---
name: article-review
description: Prepare an MPForge article for human review by consolidating deterministic lint, assets, previews, facts, and unresolved risks without granting approval.
---

# Article review

Run `mpforge review <article>` and inspect the current lint report, asset
manifest, preview report, article/build hashes, and lifecycle state. Summarize
the human checklist under content, title/summary, facts and citations, image
source and rights, mobile previews, dark mode, account selection, sensitive
information, and unfinished placeholders. Link each unresolved item to its
diagnostic, asset, or preview evidence instead of replacing deterministic
results with prose judgment.

Use `mpforge request-review <article>` only when deterministic blockers are
resolved and the user wants human review requested. This skill may prepare the
checklist and report blockers, but it must not check items on a person's behalf,
run interactive approval, write an approval record, claim that warnings were
acknowledged, or change the article to `approved`.
