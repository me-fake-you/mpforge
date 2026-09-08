---
name: draft-publisher
description: Safely prepare Mock or real WeChat drafts through MPForge approval gates and redacted receipts.
---

# Draft publisher

Run mpforge lint <article> and confirm the article frontmatter is approved before any draft adapter. Use mpforge draft <article> --mock for local demonstrations and tests. For a real adapter, require an explicit account alias and separate user confirmation with --confirm; credentials must come from the secure runtime and must never be logged or written to a receipt.

If approval, clean deterministic lint, account identity, or confirmation is missing, stop with a clear reason. v0.1 creates drafts only; it never broadcasts. Inspect the redacted receipt with mpforge audit <article> or the MCP receipt tool. Do not invent HTML or call a real endpoint directly.
