import { describe, expect, it } from "vitest";
import {
  bindPreviewEvidence,
  parseChromiumPreviewReport,
} from "../../services/previewEvidence";

function report() {
  return {
    schema: "mpforge.preview/v1",
    preview_version: "mpforge-preview/0.1.0",
    article_id: "article-1",
    compatibility_notice: "simulation only",
    generated_at: "2026-09-01T00:00:00.000Z",
    source_hash: "source-current",
    rendered_html_hash: "render-current",
    stage_hashes: { raw: "raw", safe: "safe", wechat: "wechat" },
    viewport: [{ name: "phone-375", width: 375, height: 812 }],
    mode: ["light"],
    screenshot: ["preview-source-light.png"],
    horizontal_overflow: false,
    overflow_elements: [],
    contrast_warnings: [],
    missing_images: [],
    console_errors: [],
    page_errors: [],
    static_diagnostics: [],
    local_assets: [],
    local_asset_issues: [],
    previews: [
      {
        stage: "source",
        mode: "light",
        viewport: { name: "phone-375", width: 375, height: 812 },
        screenshot: "preview-source-light.png",
        screenshot_sha256: "screen-hash",
        screenshot_truncated: false,
        horizontal_overflow: false,
        overflow_elements: [],
        contrast_warnings: [],
        abnormal_blank_regions: [],
        oversized_images: [],
        dark_transparent_image_risks: [],
        missing_images: [],
        console_errors: [],
        page_errors: [],
        generated_at: "2026-09-01T00:00:00.000Z",
        source_hash: "source-current",
        rendered_html_hash: "render-current",
      },
    ],
    pixel_difference: { used_for_blocking: false, note: "diagnostic only" },
    report_binding_hash: "binding-hash",
  };
}

describe("Chromium preview evidence", () => {
  it("accepts a non-empty screenshot report and verifies hash binding", () => {
    const evidence = bindPreviewEvidence({
      report: report(),
      screenshots: [
        {
          name: "preview-source-light.png",
          sha256: "screen-hash",
          dataUrl: "data:image/png;base64,AA==",
        },
      ],
      currentSourceHash: "source-current",
      currentRenderedHtmlHash: "render-current",
    });

    expect(evidence.chromiumComplete).toBe(true);
    expect(evidence.stale).toBe(false);
    expect(evidence.screenshots).toHaveLength(1);
  });

  it("marks source/build hash mismatches STALE", () => {
    const evidence = bindPreviewEvidence({
      report: report(),
      screenshots: [
        { name: "preview-source-light.png", sha256: "screen-hash" },
      ],
      currentSourceHash: "changed-source",
      currentRenderedHtmlHash: "changed-render",
    });

    expect(evidence.stale).toBe(true);
    expect(evidence.staleReasons).toEqual([
      "source_hash mismatch",
      "rendered_html_hash mismatch",
    ]);
  });

  it("does not call report-only filenames verified screenshot bytes", () => {
    const evidence = bindPreviewEvidence({
      report: report(),
      currentSourceHash: "source-current",
      currentRenderedHtmlHash: "render-current",
    });

    expect(evidence.chromiumComplete).toBe(false);
    expect(evidence.screenshots[0].dataUrl).toBeUndefined();
  });

  it("rejects the former static Web report with an empty screenshot array", () => {
    expect(() =>
      parseChromiumPreviewReport({
        ...report(),
        preview_version: "mpforge-web-review/0.1.0",
        screenshot: [],
      }),
    ).toThrow(/project Chromium/);
  });
});
