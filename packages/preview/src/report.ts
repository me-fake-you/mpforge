import { sha256 } from "@mpforge/renderer";
import type {
  PreviewReport,
  PreviewReportParts,
  PreviewResult,
} from "./types.js";
import { PREVIEW_VERSION, WECHAT_SIMULATION_NOTICE } from "./types.js";

function uniqueSorted<T>(values: T[], serialize: (value: T) => string): T[] {
  const entries = new Map<string, T>();
  for (const value of values) entries.set(serialize(value), value);
  return [...entries.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, value]) => value);
}

function sortPreviews(previews: PreviewResult[]): PreviewResult[] {
  const stageOrder = { source: 0, safe: 1, wechat: 2 } as const;
  const modeOrder = { light: 0, dark: 1 } as const;
  return [...previews].sort(
    (left, right) =>
      stageOrder[left.stage] - stageOrder[right.stage] ||
      modeOrder[left.mode] - modeOrder[right.mode] ||
      left.viewport.width - right.viewport.width ||
      left.viewport.height - right.viewport.height,
  );
}

export function deterministicReportProjection(
  report: PreviewReport,
): Omit<PreviewReport, "generated_at"> {
  const { generated_at: _generatedAt, ...copy } = report;
  return {
    ...copy,
    report_binding_hash: "",
    previews: copy.previews.map(
      ({ generated_at: _entryGeneratedAt, ...preview }) => ({
        ...preview,
        generated_at: "",
      }),
    ),
  } as Omit<PreviewReport, "generated_at">;
}

export function buildPreviewReport(parts: PreviewReportParts): PreviewReport {
  const previews = sortPreviews(parts.previews);
  const report: PreviewReport = {
    schema: "mpforge.preview/v1",
    preview_version: PREVIEW_VERSION,
    article_id: parts.articleId,
    compatibility_notice: WECHAT_SIMULATION_NOTICE,
    generated_at: parts.generatedAt,
    source_hash: parts.sourceHash,
    rendered_html_hash: parts.renderedHtmlHash,
    stage_hashes: parts.stageHashes,
    ...(parts.darkStageHashes
      ? { dark_stage_hashes: parts.darkStageHashes }
      : {}),
    viewport: [...parts.viewports].sort(
      (left, right) => left.width - right.width,
    ),
    mode: ["light", "dark"],
    screenshot: previews.map((preview) => preview.screenshot),
    horizontal_overflow: previews.some(
      (preview) => preview.horizontal_overflow,
    ),
    overflow_elements: uniqueSorted(
      previews.flatMap((preview) => preview.overflow_elements),
      (value) => JSON.stringify(value),
    ),
    contrast_warnings: uniqueSorted(
      previews.flatMap((preview) => preview.contrast_warnings),
      (value) => JSON.stringify(value),
    ),
    missing_images: [
      ...new Set(previews.flatMap((preview) => preview.missing_images)),
    ].sort(),
    console_errors: [
      ...new Set(previews.flatMap((preview) => preview.console_errors)),
    ].sort(),
    page_errors: [
      ...new Set(previews.flatMap((preview) => preview.page_errors)),
    ].sort(),
    static_diagnostics: [...parts.staticDiagnostics].sort((left, right) =>
      left.fingerprint.localeCompare(right.fingerprint),
    ),
    local_assets: [...(parts.localAssets ?? [])].sort((left, right) =>
      left.original_reference.localeCompare(right.original_reference),
    ),
    local_asset_issues: [...(parts.localAssetIssues ?? [])].sort(
      (left, right) =>
        left.original_reference.localeCompare(right.original_reference) ||
        left.code.localeCompare(right.code),
    ),
    previews,
    pixel_difference: {
      used_for_blocking: false,
      note: "Screenshot hashes and optional pixel differences are supporting evidence only; DOM and computed-style checks determine layout findings.",
    },
    report_binding_hash: "",
  };
  report.report_binding_hash = sha256(
    JSON.stringify(deterministicReportProjection(report)),
  );
  return report;
}
