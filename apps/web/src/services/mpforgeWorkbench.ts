import {
  parseArticleDocument,
  validateFrontmatter,
} from "@mpforge/content-schema";
import {
  lintArticle,
  type AssetInventoryItem,
  type LintReport,
} from "@mpforge/linter";
import { renderArticle, sha256, type RenderResult } from "@mpforge/renderer";
import type { FileItem } from "../store/fileTypes";
import type { PreviewEvidence } from "./previewEvidence";

export interface WorkbenchAsset extends AssetInventoryItem {
  assetId?: string;
  path: string;
  originalSource: string;
  creator: string | null;
  processed: boolean;
  privacyMetadataPresent: boolean;
  originalSizeBytes?: number;
  optimizedSizeBytes?: number;
}

interface WorkbenchManifestAsset {
  asset_id?: unknown;
  original_reference?: unknown;
  local_path?: unknown;
  source_type?: unknown;
  source_url?: unknown;
  sha256?: unknown;
  mime_type?: unknown;
  file_size?: unknown;
  width?: unknown;
  height?: unknown;
  exif_present?: unknown;
  gps_metadata_present?: unknown;
  rights_status?: unknown;
  license?: unknown;
  creator?: unknown;
  attribution?: unknown;
  transformations?: unknown;
  build_outputs?: unknown;
}

export interface WorkbenchEvidence {
  available: boolean;
  articlePath: string | null;
  source: string;
  sourceHash: string;
  body: string;
  title: string;
  author: string;
  updatedAt: string;
  status: string;
  theme: string;
  frontmatterValid: boolean;
  frontmatterErrors: string[];
  lint: LintReport | null;
  light: RenderResult | null;
  dark: RenderResult | null;
  assets: WorkbenchAsset[];
  preview: PreviewEvidence | null;
  previewError: string | null;
  approvalInvalidated: boolean;
  approvalInvalidationReason: string | null;
  previousApprovalId: string | null;
  reviewReady: boolean;
  draftReady: boolean;
}

const EMPTY_EVIDENCE: WorkbenchEvidence = {
  available: false,
  articlePath: null,
  source: "",
  sourceHash: "",
  body: "",
  title: "",
  author: "",
  updatedAt: "",
  status: "unavailable",
  theme: "minimal",
  frontmatterValid: false,
  frontmatterErrors: ["Open a Content-as-Code article first"],
  lint: null,
  light: null,
  dark: null,
  assets: [],
  preview: null,
  previewError: null,
  approvalInvalidated: false,
  approvalInvalidationReason: null,
  previousApprovalId: null,
  reviewReady: false,
  draftReady: false,
};

function normalizePath(value: string): string {
  const segments: string[] = [];
  for (const segment of value.replace(/\\/g, "/").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  return segments.join("/").toLocaleLowerCase();
}

function directoryOf(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  return normalized.slice(0, Math.max(0, normalized.lastIndexOf("/")));
}

function imageReferences(markdown: string): string[] {
  const references = new Set<string>();
  const pattern = /!\[[^\]]*\]\(([^\s)]+)(?:\s+["'][^"']*["'])?\)/g;
  for (const match of markdown.matchAll(pattern)) {
    const reference = match[1];
    if (reference && !/^https?:\/\//i.test(reference))
      references.add(reference);
  }
  return [...references].sort();
}

export function buildAssetInventory(
  articlePath: string,
  markdown: string,
  files: readonly FileItem[],
  assetManifest?: string,
): WorkbenchAsset[] {
  const directory = directoryOf(articlePath);
  let manifestAssets: WorkbenchManifestAsset[] = [];
  if (assetManifest?.trim()) {
    try {
      const parsed = JSON.parse(assetManifest) as { assets?: unknown };
      if (Array.isArray(parsed.assets)) {
        manifestAssets = parsed.assets.filter(
          (asset): asset is WorkbenchManifestAsset =>
            Boolean(asset) && typeof asset === "object",
        );
      }
    } catch {
      // A malformed manifest remains visible as unknown evidence and is
      // independently blocked by deterministic lint/review validation.
    }
  }
  const markdownReferences = imageReferences(markdown);
  const inventoryReferences = [
    ...markdownReferences,
    ...manifestAssets
      .map((asset) =>
        typeof asset.local_path === "string" &&
        markdownReferences.includes(asset.local_path)
          ? ""
          : typeof asset.original_reference === "string"
            ? asset.original_reference
            : typeof asset.local_path === "string"
              ? asset.local_path
              : "",
      )
      .filter(
        (reference) => reference && !markdownReferences.includes(reference),
      ),
  ];
  return inventoryReferences.map((reference) => {
    const manifest = manifestAssets.find(
      (asset) =>
        asset.original_reference === reference ||
        asset.local_path === reference,
    );
    const manifestLocalPath =
      typeof manifest?.local_path === "string" ? manifest.local_path : null;
    const expected = normalizePath(
      `${directory}/${manifestLocalPath ?? reference}`,
    );
    const originalExpected = normalizePath(`${directory}/${reference}`);
    const match = files.find((file) => {
      const candidate = normalizePath(file.path);
      return candidate === expected || candidate === originalExpected;
    });
    const outputs = Array.isArray(manifest?.build_outputs)
      ? (manifest.build_outputs as Array<Record<string, unknown>>)
      : [];
    const optimized = outputs.find(
      (output) => typeof output.file_size === "number",
    );
    const rightsStatus = ["approved", "pending", "blocked", "unknown"].includes(
      String(manifest?.rights_status),
    )
      ? (manifest?.rights_status as WorkbenchAsset["rightsStatus"])
      : "unknown";
    const sourceType = [
      "local",
      "remote",
      "generated",
      "user_owned",
      "project_asset",
    ].includes(String(manifest?.source_type))
      ? (manifest?.source_type as WorkbenchAsset["sourceType"])
      : "local";
    return {
      assetId:
        typeof manifest?.asset_id === "string" ? manifest.asset_id : undefined,
      reference,
      path: match?.path ?? `${directory}/${manifestLocalPath ?? reference}`,
      exists: Boolean(match),
      sizeBytes:
        typeof manifest?.file_size === "number"
          ? manifest.file_size
          : match?.size,
      originalSizeBytes:
        typeof manifest?.file_size === "number"
          ? manifest.file_size
          : match?.size,
      optimizedSizeBytes:
        typeof optimized?.file_size === "number"
          ? optimized.file_size
          : undefined,
      width: typeof manifest?.width === "number" ? manifest.width : undefined,
      height:
        typeof manifest?.height === "number" ? manifest.height : undefined,
      sha256:
        typeof manifest?.sha256 === "string" ? manifest.sha256 : undefined,
      localPath: manifestLocalPath ?? undefined,
      sourceType,
      sourceUrl:
        typeof manifest?.source_url === "string" ? manifest.source_url : null,
      rightsStatus,
      license: typeof manifest?.license === "string" ? manifest.license : null,
      creator: typeof manifest?.creator === "string" ? manifest.creator : null,
      attribution:
        typeof manifest?.attribution === "string" ? manifest.attribution : null,
      mimeType:
        typeof manifest?.mime_type === "string"
          ? manifest.mime_type
          : undefined,
      originalSource:
        typeof manifest?.source_url === "string"
          ? manifest.source_url
          : reference,
      processed:
        (Array.isArray(manifest?.transformations) &&
          manifest.transformations.length > 0) ||
        outputs.length > 0,
      privacyMetadataPresent:
        manifest?.exif_present === true ||
        manifest?.gps_metadata_present === true,
    };
  });
}

export function buildWorkbenchEvidence(input: {
  articlePath?: string | null;
  source?: string | null;
  files?: readonly FileItem[];
  assetManifest?: string;
  approvalInvalidations?: string;
  approvalRecords?: string;
  preview?: PreviewEvidence | null;
  previewError?: string | null;
}): WorkbenchEvidence {
  if (!input.articlePath || !input.source) return { ...EMPTY_EVIDENCE };
  const document = parseArticleDocument(input.source);
  const validation = validateFrontmatter(document.frontmatter);
  const theme =
    typeof document.frontmatter.theme === "string"
      ? document.frontmatter.theme
      : "minimal";
  const status =
    typeof document.frontmatter.status === "string"
      ? document.frontmatter.status
      : "invalid";
  const cover =
    typeof document.frontmatter.cover === "string"
      ? document.frontmatter.cover
      : "";
  const assets = buildAssetInventory(
    input.articlePath,
    cover ? `${document.body}\n\n![cover](${cover})` : document.body,
    input.files ?? [],
    input.assetManifest,
  );
  const invalidationLines = (input.approvalInvalidations ?? "")
    .split(/\r?\n/)
    .filter(Boolean);
  let latestInvalidation: Record<string, unknown> | null = null;
  if (invalidationLines.length > 0) {
    try {
      const parsed = JSON.parse(invalidationLines.at(-1)!) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        latestInvalidation = parsed as Record<string, unknown>;
      }
    } catch {
      latestInvalidation = null;
    }
  }
  const light = renderArticle({
    markdown: document.body,
    themeId: theme,
    colorScheme: "light",
  });
  const dark = renderArticle({
    markdown: document.body,
    themeId: theme,
    colorScheme: "dark",
  });
  const repeated = renderArticle({
    markdown: document.body,
    themeId: theme,
    colorScheme: "light",
  });
  const sourceHash = sha256(
    input.source.replace(
      /^(status|human_reviewed|updated_at|version):[^\r\n]*$/gm,
      "$1: <workflow-managed>",
    ),
  );
  const lint = lintArticle({
    articlePath: input.articlePath.replace(/\\/g, "/"),
    frontmatter: document.frontmatter,
    markdown: document.body,
    renderedHtml: light.rawHtml,
    safeHtml: light.safeHtml,
    wechatHtml: light.wechatHtml,
    renderedCss: light.css,
    assets,
    approvalRecordExists: Boolean(input.approvalRecords?.trim()),
    determinism: {
      firstHtmlHash: light.hashes.html,
      secondHtmlHash: repeated.hashes.html,
    },
    sourceHash,
    renderedHtmlHash: light.renderedHtmlHash,
    generatedAt:
      typeof document.frontmatter.updated_at === "string"
        ? document.frontmatter.updated_at
        : "1970-01-01T00:00:00.000Z",
  });
  const reviewReady = validation.valid && lint.summary.errors === 0;
  return {
    available: true,
    articlePath: input.articlePath,
    source: input.source,
    sourceHash,
    body: document.body,
    title:
      typeof document.frontmatter.title === "string"
        ? document.frontmatter.title
        : "Untitled article",
    author:
      typeof document.frontmatter.author === "string"
        ? document.frontmatter.author
        : "Unknown author",
    updatedAt:
      typeof document.frontmatter.updated_at === "string"
        ? document.frontmatter.updated_at
        : "unknown",
    status,
    theme,
    frontmatterValid: validation.valid,
    frontmatterErrors: validation.errors,
    lint,
    light,
    dark,
    assets,
    preview: input.preview ?? null,
    previewError: input.previewError ?? null,
    approvalInvalidated: Boolean(latestInvalidation),
    approvalInvalidationReason:
      typeof latestInvalidation?.reason === "string"
        ? latestInvalidation.reason
        : null,
    previousApprovalId:
      typeof latestInvalidation?.previous_approval_id === "string"
        ? latestInvalidation.previous_approval_id
        : null,
    reviewReady,
    draftReady: reviewReady && status === "approved",
  };
}
