import { describe, expect, it } from "vitest";
import {
  applySafeFixes,
  canCreateDraft,
  formatGitHubAnnotations,
  lintArticle,
  serializeLintReport,
} from "./index.js";

function validInput() {
  return {
    articlePath: "content/example/article.md",
    frontmatter: {
      id: "article-1",
      title: "A reviewed article",
      summary: "A useful summary",
      author: "MPForge",
      account: "demo",
      theme: "minimal",
      status: "reviewed",
      cover: "assets/cover.png",
      original: true,
      ai_assisted: false,
      ai_tasks: [],
      human_reviewed: true,
      need_open_comment: true,
      only_fans_can_comment: false,
      created_at: "2026-08-31T00:00:00.000Z",
      updated_at: "2026-08-31T00:00:00.000Z",
    },
    markdown: "# A reviewed article\n\n![cover](assets/cover.png)\n\nSafe text.",
    renderedHtml: "<h1>A reviewed article</h1>",
    renderedCss: "section { max-width: 100%; }",
    assets: [
      {
        reference: "assets/cover.png",
        exists: true,
        sizeBytes: 1024,
        width: 900,
        height: 500,
      },
    ],
    determinism: { firstHtmlHash: "abc", secondHtmlHash: "abc" },
  };
}

describe("lintArticle", () => {
  it("passes a complete deterministic article", () => {
    const report = lintArticle(validInput());
    expect(report.passed).toBe(true);
    expect(report.summary.errors).toBe(0);
    expect(canCreateDraft(report)).toBe(true);
  });

  it("blocks missing and external images", () => {
    const input = validInput();
    input.markdown =
      "# Images\n\n![](assets/missing.png)\n\n![remote](https://example.test/a.png)";
    input.assets = [];
    const report = lintArticle(input);
    expect(report.issues.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "image.alt.missing",
        "image.local.missing",
        "image.external",
      ]),
    );
    expect(canCreateDraft(report)).toBe(false);
  });

  it("detects risky HTML, CSS, local paths, placeholders, and secrets", () => {
    const input = validInput();
    input.markdown = [
      "# Unsafe",
      "",
      "TODO add proof",
      "<script>alert(1)</script>",
      "C:\\Users\\writer\\private.png",
      "api_key=sk-123456789012345678901234567890",
    ].join("\n");
    input.renderedCss = "@import url(https://example.test/a.css); position: fixed";
    const codes = lintArticle(input).issues.map((item) => item.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        "html.tag.risky",
        "css.compatibility.risky",
        "path.absolute.local",
        "content.placeholder",
        "secret.possible",
      ]),
    );
  });

  it("checks headings, tables, code overflow, paragraphs, and determinism", () => {
    const input = validInput();
    input.markdown = [
      "# Same",
      "### Same",
      "",
      "| a | b | c | d | e | f | g |",
      "| - | - | - | - | - | - | - |",
      "",
      "```txt",
      "x".repeat(101),
      "```",
      "",
      "p".repeat(601),
    ].join("\n");
    input.determinism = { firstHtmlHash: "one", secondHtmlHash: "two" };
    const codes = lintArticle(input).issues.map((item) => item.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        "heading.level.jump",
        "heading.duplicate",
        "table.too-wide",
        "code.overflow",
        "paragraph.too-long",
        "build.nondeterministic",
      ]),
    );
  });

  it("provides stable JSON and GitHub Actions annotations", () => {
    const report = lintArticle({ ...validInput(), markdown: "# Draft\n\nTODO" });
    expect(serializeLintReport(report)).toBe(serializeLintReport(report));
    expect(formatGitHubAnnotations(report)[0]).toMatch(/^::error /);
  });
});

describe("applySafeFixes", () => {
  it("only applies deterministic whitespace fixes", () => {
    const result = applySafeFixes("# Title  \r\n\r\n\r\nBody\t\r\n");
    expect(result.markdown).toBe("# Title\n\nBody\n");
    expect(result.applied).toEqual(["whitespace.trailing", "paragraph.empty"]);
  });
});
