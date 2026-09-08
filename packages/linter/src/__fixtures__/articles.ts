import type { LintInput } from "../types.js";

export function validArticle(overrides: Partial<LintInput> = {}): LintInput {
  const base: LintInput = {
    articlePath: "content/valid-article/article.md",
    articleSlug: "valid-article",
    frontmatter: {
      schema_version: 1,
      version: 1,
      id: "fixture-valid-001",
      slug: "valid-article",
      title: "Deterministic publishing",
      summary: "A complete fixture used to test the publication gate.",
      author: "MPForge",
      account: "fixture-account",
      theme: "minimal",
      status: "reviewed",
      cover: "assets/cover.png",
      source_url: null,
      original: true,
      ai_assisted: false,
      ai_tasks: [],
      human_reviewed: true,
      need_open_comment: true,
      only_fans_can_comment: false,
      created_at: "2026-09-01T00:00:00.000Z",
      updated_at: "2026-09-01T00:00:00.000Z",
    },
    markdown:
      "# Deterministic publishing\n\nReviewed content with a local image.\n\n![cover](assets/cover.png)",
    renderedHtml:
      '<h1>Deterministic publishing</h1><p>Reviewed content.</p><img alt="cover" style="max-width:100%;height:auto" src="assets/cover.png">',
    renderedCss: "section{max-width:100%;color:#222;background:#fff}",
    safeHtml:
      '<h1>Deterministic publishing</h1><p>Reviewed content.</p><img alt="cover" style="max-width:100%;height:auto" src="assets/cover.png">',
    wechatHtml:
      '<h1>Deterministic publishing</h1><p>Reviewed content.</p><img alt="cover" style="max-width:100%;height:auto" src="assets/cover.png">',
    assets: [
      {
        reference: "assets/cover.png",
        exists: true,
        sizeBytes: 1024,
        width: 900,
        height: 500,
        sha256: "fixture-sha256",
        sourceType: "user_owned",
        rightsStatus: "approved",
        license: "User-owned",
      },
    ],
    determinism: { firstHtmlHash: "same", secondHtmlHash: "same" },
    sourceHash: "source-hash",
    renderedHtmlHash: "html-hash",
    generatedAt: "2026-09-01T00:00:00.000Z",
  };
  return { ...base, ...overrides };
}
