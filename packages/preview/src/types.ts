import type { LintIssue } from "@mpforge/linter";

export const PREVIEW_VERSION = "mpforge-preview/0.1.0" as const;

export const WECHAT_SIMULATION_NOTICE =
  "微信兼容模拟预览，最终效果仍应在公众号草稿箱中人工确认。" as const;

export type PreviewStage = "source" | "safe" | "wechat";
export type PreviewMode = "light" | "dark";

export interface PreviewViewport {
  name: string;
  width: number;
  height: number;
}

export const DEFAULT_PREVIEW_VIEWPORTS: readonly PreviewViewport[] = [
  { name: "phone-375", width: 375, height: 812 },
  { name: "phone-402", width: 402, height: 874 },
] as const;

export interface HtmlPreviewStages {
  raw: string;
  safe: string;
  wechat: string;
}

export interface LocalPreviewAsset {
  original_reference: string;
  local_path: string;
  sha256: string;
  mime_type: string;
  byte_length: number;
}

export interface LocalPreviewAssetIssue {
  original_reference: string;
  code:
    | "empty-reference"
    | "network-blocked"
    | "unsupported-protocol"
    | "base-url-missing"
    | "absolute-path-blocked"
    | "invalid-reference"
    | "path-traversal"
    | "symlink-escape"
    | "not-found"
    | "not-a-file"
    | "asset-too-large"
    | "asset-budget-exceeded"
    | "unsupported-image"
    | "unsafe-svg";
  message: string;
}

export interface RectSnapshot {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ElementSnapshot {
  selector: string;
  parent_selector: string | null;
  tag: string;
  text: string;
  rect: RectSnapshot;
  client_width: number;
  client_height: number;
  scroll_width: number;
  scroll_height: number;
  display: string;
  visibility: string;
  opacity: number;
  overflow_x: string;
  overflow_y: string;
  position: string;
  color: string;
  background_color: string;
  font_size: number;
  font_weight: number;
  natural_width: number | null;
  natural_height: number | null;
  image_complete: boolean | null;
  image_has_transparency: boolean | null;
  image_average_luminance: number | null;
  image_analysis_error: string | null;
}

export interface LayoutSnapshot {
  viewport: PreviewViewport;
  document_scroll_width: number;
  document_scroll_height: number;
  body_scroll_width: number;
  body_scroll_height: number;
  elements: ElementSnapshot[];
}

export interface OverflowElement {
  selector: string;
  kind: "table" | "code" | "image" | "element";
  reason: "viewport" | "internal-scroll";
  overflow_pixels: number;
}

export interface ContrastWarning {
  selector: string;
  foreground: string;
  background: string;
  ratio: number;
  required_ratio: number;
}

export interface ClippedElement {
  selector: string;
  axis: "horizontal" | "vertical" | "both";
  clipped_pixels: number;
}

export interface InvisibleTextWarning {
  selector: string;
  reason:
    | "display"
    | "visibility"
    | "opacity"
    | "font-size"
    | "transparent-color";
  excerpt: string;
}

export interface HeadingOverlap {
  heading: string;
  obstructing_element: string;
  overlap_area: number;
}

export interface BlankRegion {
  after_selector: string;
  before_selector: string;
  gap_pixels: number;
}

export interface OversizedImageWarning {
  selector: string;
  natural_width: number;
  natural_height: number;
  rendered_height: number;
  reason: "pixel-count" | "dimensions" | "rendered-height";
}

export interface DarkTransparentImageRisk {
  selector: string;
  average_luminance: number | null;
  reason: "dark-content-on-transparency" | "transparency-uninspectable";
}

export interface LayoutDetection {
  horizontal_overflow: boolean;
  overflow_elements: OverflowElement[];
  table_overflow: string[];
  code_overflow: string[];
  image_overflow: string[];
  content_clipped: ClippedElement[];
  invisible_text: InvisibleTextWarning[];
  heading_overlaps: HeadingOverlap[];
  contrast_warnings: ContrastWarning[];
  abnormal_blank_regions: BlankRegion[];
  oversized_images: OversizedImageWarning[];
  dark_transparent_image_risks: DarkTransparentImageRisk[];
  missing_images: string[];
}

export interface PreviewResult extends LayoutDetection {
  stage: PreviewStage;
  viewport: PreviewViewport;
  mode: PreviewMode;
  screenshot: string;
  screenshot_sha256: string;
  screenshot_truncated: boolean;
  console_errors: string[];
  page_errors: string[];
  generated_at: string;
  source_hash: string;
  rendered_html_hash: string;
}

export interface PreviewReport {
  schema: "mpforge.preview/v1";
  preview_version: typeof PREVIEW_VERSION;
  article_id: string;
  compatibility_notice: typeof WECHAT_SIMULATION_NOTICE;
  generated_at: string;
  source_hash: string;
  rendered_html_hash: string;
  stage_hashes: {
    raw: string;
    safe: string;
    wechat: string;
  };
  /** Mode-specific renderer inputs, when supplied; bound into report_binding_hash. */
  dark_stage_hashes?: PreviewReport["stage_hashes"];
  viewport: PreviewViewport[];
  mode: PreviewMode[];
  screenshot: string[];
  horizontal_overflow: boolean;
  overflow_elements: OverflowElement[];
  contrast_warnings: ContrastWarning[];
  missing_images: string[];
  console_errors: string[];
  page_errors: string[];
  static_diagnostics: LintIssue[];
  local_assets: LocalPreviewAsset[];
  local_asset_issues: LocalPreviewAssetIssue[];
  previews: PreviewResult[];
  pixel_difference: {
    used_for_blocking: false;
    note: string;
  };
  report_binding_hash: string;
}

export interface GeneratePreviewInput {
  articleId: string;
  stages: HtmlPreviewStages;
  /** Actual dark renderer output. Omit only for HTML that already adapts to color-scheme. */
  darkStages?: HtmlPreviewStages;
  sourceHash: string;
  renderedHtmlHash: string;
  outputDirectory: string;
  /** Used only for resolving article-local assets. No network fetch is performed. */
  baseUrl?: string;
  chromiumExecutablePath?: string;
  viewports?: readonly PreviewViewport[];
  /** Safe-stage screenshots are useful for review but are not part of the four stable primary names. */
  includeSafeStage?: boolean;
  generatedAt?: string;
}

export interface PreviewReportParts {
  articleId: string;
  sourceHash: string;
  renderedHtmlHash: string;
  stageHashes: PreviewReport["stage_hashes"];
  darkStageHashes?: PreviewReport["stage_hashes"];
  generatedAt: string;
  viewports: readonly PreviewViewport[];
  staticDiagnostics: LintIssue[];
  localAssets?: LocalPreviewAsset[];
  localAssetIssues?: LocalPreviewAssetIssue[];
  previews: PreviewResult[];
}
