import { describe, expect, it } from "vitest";
import { expandCssVariables } from "./cssVariables";
import { renderArticle } from "./renderArticle";
import { sha256 } from "./sha256";

const LONG_ARTICLE = `# A deterministic article

Paragraph with **strong**, *emphasis*, ==highlight==, and [a source](https://example.test/source).

## Data

> A quote that should remain inside the article.

- one
- [x] done

| Name | Value |
| --- | ---: |
| width | 100% |

### Code

${"```"}json
{"ok": true}
${"```"}

### Math

Inline $x^2$ and a block:

$$
E = mc^2
$$

![local fixture](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==)
`;

describe("renderArticle", () => {
  it("is byte-identical across repeated renders", () => {
    const first = renderArticle({
      markdown: LONG_ARTICLE,
      themeId: "minimal",
      colorScheme: "light",
      linkToFootnote: true,
      includeSourcePosition: true,
    });
    for (let i = 0; i < 20; i += 1) {
      expect(
        renderArticle({
          markdown: LONG_ARTICLE,
          themeId: "minimal",
          colorScheme: "light",
          linkToFootnote: true,
          includeSourcePosition: true,
        }),
      ).toEqual(first);
    }
    expect(first.html).toContain('id="wemd"');
    expect(first.html).toContain("data-wemd-source-start");
    expect(first.html).toContain("hljs-literal");
    expect(first.html).toContain("block-equation");
    expect(first.html).toContain("table-container");
    expect(first.assetReferences).toEqual([
      "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
    ]);
    expect(first.html).toContain('style="');
    expect(first.html).toContain('data-tool="MPForge"');
    expect(first.sourceHash).toBe(first.hashes.markdown);
    expect(first.renderedHtmlHash).toBe(first.hashes.document);
    expect(first.themeHash).toBe(first.hashes.theme);
    for (const hash of [
      first.sourceHash,
      first.renderedHtmlHash,
      first.themeHash,
    ]) {
      expect(hash).toMatch(/^[\da-f]{64}$/);
    }
  });

  it("uses explicit dark CSS and remains mobile-width safe", () => {
    const light = renderArticle({
      markdown: LONG_ARTICLE,
      themeId: "academic-blue",
    });
    const dark = renderArticle({
      markdown: LONG_ARTICLE,
      themeId: "academic-blue",
      colorScheme: "dark",
    });
    expect(light.css).not.toBe(dark.css);
    expect(dark.css).toContain("#d9e6f2");
    expect(dark.css).not.toContain("var(");
    for (const result of [light, dark]) {
      expect(result.css).toMatch(/max-width:\s*100%/);
      expect(result.css).toMatch(/overflow(?:-x)?:\s*auto/);
      expect(result.css).toMatch(/#wemd \.table-container/);
    }
  });

  it("resolves designer variables before heuristic dark conversion", () => {
    const css = `#wemd { --ink: #111111; --paper: #ffffff; color: var(--ink); background: var(--paper); }`;
    expect(expandCssVariables(css)).not.toContain("var(");
    const result = renderArticle({
      markdown: "# Variables",
      themeId: "custom-vars",
      themeCss: css,
      colorScheme: "dark",
    });
    expect(result.css).not.toContain("var(");
    expect(result.css).not.toContain("#111111");
    expect(result.css).not.toContain("#ffffff");
  });

  it("warns on unknown themes and external assets without using the network", () => {
    const result = renderArticle({
      markdown: "![external](https://example.test/picture.png)",
      themeId: "does-not-exist",
    });
    expect(result.themeId).toBe("minimal");
    expect(result.warnings).toContain(
      "Unknown theme 'does-not-exist'; using minimal",
    );
    expect(
      result.warnings.some((warning) => warning.includes("External asset")),
    ).toBe(true);
  });

  it("removes active HTML and CSS rather than serializing script markup", () => {
    const result = renderArticle({
      markdown: `# Safe document

<script>alert("markdown")</script>
<iframe src="https://example.test"></iframe>
<img src="jav&#x61;script:alert(1)" onerror="alert(2)" alt="unsafe">
<input autofocus value="side effect">`,
      themeId: "custom",
      themeCss:
        "@import 'https://example.test/x.css'; #wemd { color: red; } </style><script>alert(1)</script>",
    });
    expect(result.documentHtml).not.toMatch(/<(?:script|iframe)\b/i);
    expect(result.documentHtml).not.toMatch(/\bonerror\s*=/i);
    expect(result.documentHtml).not.toMatch(/javascript\s*:/i);
    expect(result.documentHtml).not.toContain("jav&#x61;script");
    expect(result.documentHtml).not.toMatch(/\bautofocus\b/i);
    expect(result.documentHtml).not.toMatch(/@import/i);
    expect(result.warnings).toContain(
      "Unsafe constructs were removed from theme CSS",
    );
    expect(result.rawHtml).toMatch(/<(?:script|iframe)\b/i);
    expect(result.safeHtml).not.toMatch(/<(?:script|iframe)\b/i);
  });

  it("produces separately hashable safe and WeChat simulation stages", () => {
    const result = renderArticle({
      markdown:
        '# Mobile\n\n<img src="assets/wide.png" alt="wide" style="width:900px">\n\n```text\n' +
        "a very long line\n```",
      themeId: "minimal",
    });

    expect(result.rawDocumentHtml).toContain("assets/wide.png");
    expect(result.safeDocumentHtml).toBe(result.documentHtml);
    expect(result.wechatDocumentHtml).toContain("max-width:100%");
    expect(result.wechatDocumentHtml).toContain("overflow-x:auto");
    expect(result.wechatHtmlHash).toBe(sha256(result.wechatDocumentHtml));
  });

  it("uses real SHA-256 and changes each evidence hash only with its input", () => {
    expect(sha256("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    const baseline = renderArticle({
      markdown: "# Evidence",
      themeId: "minimal",
    });
    const sourceChanged = renderArticle({
      markdown: "# Evidence!",
      themeId: "minimal",
    });
    const themeChanged = renderArticle({
      markdown: "# Evidence",
      themeId: "academic-blue",
    });
    const darkPreview = renderArticle({
      markdown: "# Evidence",
      themeId: "minimal",
      colorScheme: "dark",
    });

    expect(sourceChanged.sourceHash).not.toBe(baseline.sourceHash);
    expect(sourceChanged.themeHash).toBe(baseline.themeHash);
    expect(themeChanged.sourceHash).toBe(baseline.sourceHash);
    expect(themeChanged.themeHash).not.toBe(baseline.themeHash);
    expect(darkPreview.themeHash).toBe(baseline.themeHash);
    expect(darkPreview.renderedHtmlHash).not.toBe(baseline.renderedHtmlHash);
  });

  it("normalizes source line endings for HTML while hashing the exact source", () => {
    const lf = renderArticle({ markdown: "# Line one\n\nLine two\n" });
    const crlf = renderArticle({ markdown: "# Line one\r\n\r\nLine two\r\n" });
    expect(crlf.html).toBe(lf.html);
    expect(crlf.sourceHash).not.toBe(lf.sourceHash);

    const customV1 = renderArticle({
      markdown: "# Versioned",
      themeId: "original-custom",
      themeVersion: "1.0.0",
      themeCss: "#wemd { color: #334455; }",
    });
    const customV2 = renderArticle({
      markdown: "# Versioned",
      themeId: "original-custom",
      themeVersion: "2.0.0",
      themeCss: "#wemd { color: #334455; }",
    });
    expect(customV2.html).toBe(customV1.html);
    expect(customV2.themeHash).not.toBe(customV1.themeHash);
  });

  it("supports a validated primary colour override without mutating the registry", () => {
    const custom = renderArticle({
      markdown: "# Accent",
      themeId: "academic-blue",
      primaryColor: "#2468ac",
    });
    const original = renderArticle({
      markdown: "# Accent",
      themeId: "academic-blue",
    });
    const invalid = renderArticle({
      markdown: "# Accent",
      themeId: "academic-blue",
      primaryColor: "red; background:url(javascript:alert(1))",
    });
    expect(custom.css).toContain("#2468ac");
    expect(custom.themeHash).not.toBe(original.themeHash);
    expect(invalid.css).toBe(original.css);
    expect(invalid.warnings).toContain(
      "Invalid primaryColor 'red; background:url(javascript:alert(1))'; using theme default",
    );
  });
});
