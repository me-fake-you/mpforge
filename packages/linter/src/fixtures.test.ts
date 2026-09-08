import { describe, expect, it } from "vitest";
import { lintArticle } from "./linter.js";
import { validArticle } from "./__fixtures__/articles.js";

describe("Round 2 article fixtures", () => {
  it("valid-article has no ERROR and preserves complete diagnostics", () => {
    const report = lintArticle(validArticle());
    expect(report.error_count).toBe(0);
    expect(report.publish_blocked).toBe(false);
    for (const item of report.diagnostics) {
      expect(item).toEqual(
        expect.objectContaining({
          rule_id: expect.any(String),
          severity: expect.stringMatching(/^(ERROR|WARNING|INFO)$/),
          category: expect.any(String),
          message: expect.any(String),
          file: expect.any(String),
          line: expect.any(Number),
          column: expect.any(Number),
          excerpt: expect.any(String),
          suggestion: expect.any(String),
          autofix_available: expect.any(Boolean),
          autofix_safe: expect.any(Boolean),
          documentation_key: expect.any(String),
          fingerprint: expect.stringMatching(/^[a-f0-9]{16}$/),
        }),
      );
    }
  });

  it("missing-cover reports an explicit cover diagnostic", () => {
    const input = validArticle();
    input.frontmatter = { ...input.frontmatter, cover: "" };
    expect(
      lintArticle(input).diagnostics.some(
        (d) => d.rule_id === "frontmatter.cover.missing",
      ),
    ).toBe(true);
  });

  it("missing-image is an ERROR", () => {
    const input = validArticle({
      markdown: "# Missing\n\n![lost](assets/lost.png)",
      assets: [],
    });
    const issue = lintArticle(input).diagnostics.find(
      (d) => d.rule_id === "image.local.missing",
    );
    expect(issue?.severity).toBe("ERROR");
  });

  it("overflowing-table and code are visible warnings", () => {
    const input = validArticle({
      markdown: `# Wide\n\n| a | b | c | d | e | f | g |\n| - | - | - | - | - | - | - |\n\n\`\`\`txt\n${"x".repeat(110)}\n\`\`\``,
      renderedHtml: "<table><tr><td>x</td></tr></table><pre>code</pre>",
      safeHtml: undefined,
      wechatHtml: undefined,
    });
    const ids = lintArticle(input).diagnostics.map((d) => d.rule_id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "table.too-wide",
        "code.overflow",
        "html.raw.table-overflow",
        "html.raw.code-overflow",
      ]),
    );
  });

  it("frontmatter checks dates, chronology, slug, duplicates, types, and approvals", () => {
    const input = validArticle({
      articleId: "immutable-id",
      approvalRecordExists: false,
      projectArticles: [
        {
          id: "duplicate",
          slug: "other",
          articlePath: "content/other/article.md",
        },
      ],
    });
    input.frontmatter = {
      ...input.frontmatter,
      id: "duplicate",
      slug: "Bad Slug",
      status: "approved",
      human_reviewed: false,
      original: "true",
      ai_assisted: "false",
      ai_tasks: [1],
      created_at: "invalid",
      updated_at: "2020-01-01T00:00:00Z",
      unknown_extension: "kept",
    };
    const report = lintArticle(input);
    const ids = report.diagnostics.map((d) => d.rule_id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "frontmatter.slug.invalid",
        "frontmatter.slug.path-conflict",
        "frontmatter.id.path-conflict",
        "frontmatter.id.duplicate",
        "frontmatter.boolean.string",
        "frontmatter.ai_tasks.invalid",
        "frontmatter.created_at.invalid",
        "frontmatter.human-reviewed.status-conflict",
        "frontmatter.approved.missing-record",
        "frontmatter.field.unknown",
      ]),
    );
    expect(report.publish_blocked).toBe(true);
  });
});
