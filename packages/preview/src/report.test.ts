import { describe, expect, it } from "vitest";
import { buildPreviewReport, deterministicReportProjection } from "./report.js";
import type { PreviewReportParts, PreviewResult } from "./types.js";

const hash = (character: string): string => character.repeat(64);

function preview(generatedAt: string): PreviewResult {
  return {
    stage: "source",
    viewport: { name: "phone-375", width: 375, height: 812 },
    mode: "light",
    screenshot: "preview-source-light.png",
    screenshot_sha256: hash("d"),
    screenshot_truncated: false,
    horizontal_overflow: false,
    overflow_elements: [],
    table_overflow: [],
    code_overflow: [],
    image_overflow: [],
    content_clipped: [],
    invisible_text: [],
    heading_overlaps: [],
    contrast_warnings: [],
    abnormal_blank_regions: [],
    oversized_images: [],
    dark_transparent_image_risks: [],
    missing_images: [],
    console_errors: [],
    page_errors: [],
    generated_at: generatedAt,
    source_hash: hash("a"),
    rendered_html_hash: hash("b"),
  };
}

function parts(generatedAt: string): PreviewReportParts {
  return {
    articleId: "article-1",
    sourceHash: hash("a"),
    renderedHtmlHash: hash("b"),
    stageHashes: { raw: hash("1"), safe: hash("2"), wechat: hash("3") },
    generatedAt,
    viewports: [{ name: "phone-375", width: 375, height: 812 }],
    staticDiagnostics: [],
    previews: [preview(generatedAt)],
  };
}

describe("preview report", () => {
  it("binds all deterministic evidence while excluding generated_at from the binding", () => {
    const first = buildPreviewReport(parts("2026-09-01T00:00:00.000Z"));
    const second = buildPreviewReport(parts("2026-09-02T00:00:00.000Z"));
    expect(first.report_binding_hash).toBe(second.report_binding_hash);
    expect(deterministicReportProjection(first)).toEqual(
      deterministicReportProjection(second),
    );
    expect(first.compatibility_notice).toBe(
      "微信兼容模拟预览，最终效果仍应在公众号草稿箱中人工确认。",
    );
    expect(first.source_hash).toBe(hash("a"));
    expect(first.rendered_html_hash).toBe(hash("b"));
    expect(first.pixel_difference.used_for_blocking).toBe(false);
  });
});
