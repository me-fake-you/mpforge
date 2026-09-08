import { describe, expect, it, vi } from "vitest";
import {
  applySafeFixesTransactional,
  formatLintHtml,
  lintArticle,
  serializeLintReport,
  serializeLintSarif,
  toSarif,
} from "./index.js";
import { validArticle } from "./__fixtures__/articles.js";

describe("determinism and reporters", () => {
  it("produces byte-identical JSON, fingerprints, HTML, and SARIF", () => {
    const first = lintArticle(
      validArticle({ markdown: "# Draft\n\nTODO  \n\n\nText" }),
    );
    const second = lintArticle(
      validArticle({ markdown: "# Draft\n\nTODO  \n\n\nText" }),
    );
    expect(serializeLintReport(first)).toBe(serializeLintReport(second));
    expect(formatLintHtml(first)).toBe(formatLintHtml(second));
    expect(serializeLintSarif(first)).toBe(serializeLintSarif(second));
    expect(first.diagnostics.map((d) => d.fingerprint)).toEqual(
      second.diagnostics.map((d) => d.fingerprint),
    );
  });

  it("exports valid SARIF locations and severity", () => {
    const sarif = toSarif(
      lintArticle(validArticle({ markdown: "# Draft\n\nTODO" })),
    );
    expect(sarif.version).toBe("2.1.0");
    expect(
      sarif.runs[0].results.some((result) => result.level === "error"),
    ).toBe(true);
    expect(sarif.runs[0].tool.driver.rules.length).toBeGreaterThan(0);
  });

  it("HTML reporter escapes article-controlled values and contains no script", () => {
    const report = lintArticle(
      validArticle({
        articlePath: "<img src=x onerror=alert(1)>.md",
        markdown: "# Draft\n\nTODO",
      }),
    );
    const html = formatLintHtml(report);
    expect(html).toContain("&lt;img");
    expect(html).not.toMatch(/<script/i);
  });

  it("does not interpret fenced or inline code examples as authored HTML", () => {
    const report = lintArticle(
      validArticle({
        markdown:
          "# Draft\n\n```text\ncontent/<slug>/article.md\n```\n\nUse `content/<id>` locally.",
      }),
    );
    expect(
      report.diagnostics.some(
        (diagnostic) =>
          diagnostic.rule_id === "html.raw.tag.unknown" ||
          diagnostic.rule_id === "html.raw.nesting.unclosed",
      ),
    ).toBe(false);
  });
});

describe("safe autofix transaction", () => {
  it("creates a backup and writes only deterministic whitespace fixes", async () => {
    const backup = vi.fn();
    const write = vi.fn();
    const rollback = vi.fn();
    const result = await applySafeFixesTransactional({
      markdown: "# Title  \n\n\nBody\t\n",
      createBackup: backup,
      write,
      rollback,
      validate: (updated) => updated === "# Title\n\nBody\n",
    });
    expect(result.applied).toEqual(["whitespace.trailing", "paragraph.empty"]);
    expect(result.backupCreated).toBe(true);
    expect(write).toHaveBeenCalledWith("# Title\n\nBody\n");
    expect(rollback).not.toHaveBeenCalled();
  });

  it("rolls back when validation fails", async () => {
    const rollback = vi.fn();
    await expect(
      applySafeFixesTransactional({
        markdown: "# Title  \n",
        createBackup: vi.fn(),
        write: vi.fn(),
        rollback,
        validate: () => false,
      }),
    ).rejects.toThrow("validation failed");
    expect(rollback).toHaveBeenCalledWith("# Title  \n");
  });

  it("does not create a backup when no fix is needed", async () => {
    const backup = vi.fn();
    const result = await applySafeFixesTransactional({
      markdown: "# Title\n\nBody\n",
      createBackup: backup,
      write: vi.fn(),
      rollback: vi.fn(),
    });
    expect(result.backupCreated).toBe(false);
    expect(backup).not.toHaveBeenCalled();
  });
});
