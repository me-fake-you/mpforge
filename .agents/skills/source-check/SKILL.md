---
name: source-check
description: Check whether article claims are facts or opinions, whether citations support them, and which claims are time-sensitive.
---

# Source check

Inspect the article Markdown and its cited links. Classify each material statement as fact, interpretation, forecast, or opinion; record the source supporting it; and flag a citation that does not entail the claim. Mark prices, policies, releases, people, and other time-sensitive statements with a verification date.

Use the article `source_url` and a human-readable review note. Run `mpforge
lint <article>` after edits and ensure any local citation target still resolves.
Never fabricate citations, silently replace a source, mark a human checklist
item complete, or alter approval state. If evidence is insufficient, create a
review item instead of strengthening the claim.
