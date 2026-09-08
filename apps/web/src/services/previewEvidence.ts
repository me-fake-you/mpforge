export interface PreviewScreenshotEvidence {
  name: string;
  sha256: string;
  dataUrl?: string;
}

export interface ChromiumPreviewEntry {
  stage: string;
  mode: string;
  viewport: { name: string; width: number; height: number };
  screenshot: string;
  screenshot_sha256: string;
  horizontal_overflow: boolean;
  overflow_elements: unknown[];
  contrast_warnings: unknown[];
  abnormal_blank_regions: unknown[];
  oversized_images: unknown[];
  dark_transparent_image_risks: unknown[];
  missing_images: string[];
  console_errors: string[];
  page_errors: string[];
  generated_at: string;
  source_hash: string;
  rendered_html_hash: string;
}

export interface ChromiumPreviewReport {
  schema: "mpforge.preview/v1";
  preview_version: string;
  article_id: string;
  compatibility_notice: string;
  generated_at: string;
  source_hash: string;
  rendered_html_hash: string;
  stage_hashes: { raw: string; safe: string; wechat: string };
  viewport: Array<{ name: string; width: number; height: number }>;
  mode: string[];
  screenshot: string[];
  horizontal_overflow: boolean;
  overflow_elements: unknown[];
  contrast_warnings: unknown[];
  missing_images: string[];
  console_errors: string[];
  page_errors: string[];
  static_diagnostics: unknown[];
  local_assets: unknown[];
  local_asset_issues: unknown[];
  previews: ChromiumPreviewEntry[];
  pixel_difference: { used_for_blocking: false; note: string };
  report_binding_hash: string;
}

export interface PreviewEvidence {
  report: ChromiumPreviewReport;
  screenshots: PreviewScreenshotEvidence[];
  chromiumComplete: boolean;
  stale: boolean;
  staleReasons: string[];
  loadError?: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

export function parseChromiumPreviewReport(
  value: unknown,
): ChromiumPreviewReport {
  if (!record(value)) throw new Error("Preview report must be an object.");
  if (value.schema !== "mpforge.preview/v1")
    throw new Error("Unsupported preview schema.");
  if (
    typeof value.preview_version !== "string" ||
    !value.preview_version.startsWith("mpforge-preview/")
  ) {
    throw new Error("Preview report was not produced by project Chromium.");
  }
  if (!stringArray(value.screenshot) || value.screenshot.length === 0) {
    throw new Error("Chromium screenshot evidence is empty.");
  }
  if (!Array.isArray(value.previews) || value.previews.length === 0) {
    throw new Error("Chromium preview measurements are empty.");
  }
  for (const field of [
    "article_id",
    "compatibility_notice",
    "generated_at",
    "source_hash",
    "rendered_html_hash",
    "report_binding_hash",
  ]) {
    if (typeof value[field] !== "string")
      throw new Error(`Preview field ${field} is invalid.`);
  }
  if (!record(value.stage_hashes))
    throw new Error("Preview stage hashes are invalid.");
  for (const stage of ["raw", "safe", "wechat"]) {
    if (typeof value.stage_hashes[stage] !== "string") {
      throw new Error(`Preview stage hash ${stage} is invalid.`);
    }
  }
  return value as unknown as ChromiumPreviewReport;
}

export function bindPreviewEvidence(input: {
  report: unknown;
  screenshots?: PreviewScreenshotEvidence[];
  currentSourceHash: string;
  currentRenderedHtmlHash: string;
  loadError?: string;
}): PreviewEvidence {
  const report = parseChromiumPreviewReport(input.report);
  const screenshots: PreviewScreenshotEvidence[] =
    input.screenshots ??
    report.screenshot.map((name) => ({
      name,
      sha256:
        report.previews.find((preview) => preview.screenshot === name)
          ?.screenshot_sha256 ?? "",
    }));
  const staleReasons: string[] = [];
  if (report.source_hash !== input.currentSourceHash)
    staleReasons.push("source_hash mismatch");
  if (report.rendered_html_hash !== input.currentRenderedHtmlHash) {
    staleReasons.push("rendered_html_hash mismatch");
  }
  const screenshotNames = new Set(screenshots.map((item) => item.name));
  const hashesValid = report.screenshot.every((name) => {
    const preview = report.previews.find((entry) => entry.screenshot === name);
    const loaded = screenshots.find((entry) => entry.name === name);
    return (
      screenshotNames.has(name) &&
      Boolean(preview?.screenshot_sha256) &&
      Boolean(loaded?.dataUrl) &&
      loaded?.sha256 === preview?.screenshot_sha256
    );
  });
  return {
    report,
    screenshots,
    chromiumComplete:
      report.screenshot.length > 0 &&
      report.previews.length > 0 &&
      report.screenshot.length === screenshots.length &&
      hashesValid,
    stale: staleReasons.length > 0,
    staleReasons,
    ...(input.loadError ? { loadError: input.loadError } : {}),
  };
}
