---
name: article-brief
description: Turn an editorial request into a structured MPForge article brief with audience, outcome, outline, evidence gaps, and visual slots.
---

# Article brief

Use this skill when a user needs to plan a WeChat article before drafting. Capture audience, reader outcome, thesis, outline, supporting arguments, facts that must be checked, and proposed image positions. Keep facts and hypotheses separate.

Use mpforge new <slug> when a new article directory is needed. Write the brief into content/<slug>/article.md or return structured Markdown for that file. Do not change status to approved; at most recommend draft -> reviewing.

Do not invent sources, image files, HTML, or publication credentials. Keep source_url, ai_tasks, and rights notes explicit so mpforge lint <article> can check the resulting article.
