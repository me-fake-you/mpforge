import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { DraftOperationError } from "./errors.js";
import { isSha256, prettyStableJson, sha256, stableJson } from "./crypto.js";
import { resolveChild, resolveInside } from "./safety.js";
import type { SnapshotBinding } from "./types.js";

type JsonObject = Record<string, unknown>;

interface ApprovalRecord extends JsonObject {
  approval_id: string;
  article_id: string;
  reviewer_type: string;
  source_hash: string;
  rendered_html_hash: string;
  wechat_html_hash: string;
  lint_report_hash: string;
  assets_manifest_hash: string;
  theme_hash: string;
  source_commit: string;
  result: string;
  previous_record_hash: string | null;
  record_hash: string;
}

interface AssetSource {
  sourceRelativePath: string;
  snapshotRelativePath: string;
  bytes: Uint8Array;
}

export interface ValidatedReleaseSource {
  articleDirectory: string;
  title: string;
  binding: SnapshotBinding;
  coverAssetId: string;
  bodyImageCount: number;
  criticalFiles: Map<string, Uint8Array>;
  assetFiles: AssetSource[];
  approvalRecord: ApprovalRecord;
}

function parseJson(raw: Uint8Array, label: string): JsonObject {
  try {
    const value = JSON.parse(Buffer.from(raw).toString("utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("expected an object");
    return value as JsonObject;
  } catch (error) {
    throw new DraftOperationError(
      "SOURCE_ARTIFACT_INVALID",
      `${label} is not valid JSON`,
      { reason: error instanceof Error ? error.message : String(error) },
    );
  }
}

function jsonLines<T extends JsonObject>(raw: string, label: string): T[] {
  return raw
    .split(/\r?\n/u)
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        const value = JSON.parse(line) as unknown;
        if (!value || typeof value !== "object" || Array.isArray(value))
          throw new Error("expected an object");
        return value as T;
      } catch (error) {
        throw new DraftOperationError(
          "APPROVAL_INVALID",
          `${label} line ${index + 1} is invalid`,
          { reason: error instanceof Error ? error.message : String(error) },
        );
      }
    });
}

function stringField(value: JsonObject, key: string, label: string): string {
  const field = value[key];
  if (typeof field !== "string" || !field.trim())
    throw new DraftOperationError(
      "SOURCE_ARTIFACT_INVALID",
      `${label}.${key} is required`,
    );
  return field;
}

function numberField(value: JsonObject, key: string, label: string): number {
  const field = value[key];
  if (typeof field !== "number" || !Number.isFinite(field))
    throw new DraftOperationError(
      "SOURCE_ARTIFACT_INVALID",
      `${label}.${key} must be a number`,
    );
  return field;
}

export function approvalSourceHash(source: string): string {
  const canonical = source.replace(
    /^(status|human_reviewed|updated_at|version):[^\r\n]*$/gmu,
    "$1: <workflow-managed>",
  );
  return sha256(canonical);
}

function frontmatterField(source: string, key: string): string | undefined {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(source)?.[1];
  if (!block) return undefined;
  const match = new RegExp(`^${key}:\\s*(.+?)\\s*$`, "mu").exec(block);
  if (!match) return undefined;
  return match[1].replace(/^['"]|['"]$/gu, "").trim();
}

function verifyHashChain(
  records: JsonObject[],
  idField: string,
  label: string,
): void {
  let previous: string | null = null;
  const ids = new Set<string>();
  records.forEach((record, index) => {
    const id = record[idField];
    if (typeof id !== "string" || !id || ids.has(id))
      throw new DraftOperationError(
        "APPROVAL_INVALID",
        `${label} contains a missing or duplicate id`,
        { index },
      );
    ids.add(id);
    if (record.previous_record_hash !== previous)
      throw new DraftOperationError(
        "APPROVAL_INVALID",
        `${label} hash chain is broken`,
        { index },
      );
    const { record_hash: recordHash, ...unsigned } = record;
    if (
      typeof recordHash !== "string" ||
      sha256(stableJson(unsigned)) !== recordHash
    )
      throw new DraftOperationError(
        "APPROVAL_INVALID",
        `${label} record hash is invalid`,
        { index },
      );
    previous = recordHash;
  });
}

async function readRequired(
  filePath: string,
  label: string,
): Promise<Uint8Array> {
  try {
    const information = await stat(filePath);
    if (!information.isFile()) throw new Error("not a regular file");
    return await readFile(filePath);
  } catch (error) {
    throw new DraftOperationError(
      "SOURCE_ARTIFACT_MISSING",
      `${label} is required`,
      { reason: error instanceof Error ? error.message : String(error) },
    );
  }
}

function requireEqual(
  actual: string,
  expected: string,
  code:
    | "BUILD_SOURCE_MISMATCH"
    | "LINT_SOURCE_MISMATCH"
    | "LINT_RENDER_MISMATCH"
    | "PREVIEW_SOURCE_MISMATCH"
    | "PREVIEW_RENDER_MISMATCH"
    | "PREVIEW_WECHAT_MISMATCH"
    | "BUILD_ARTIFACT_HASH_MISMATCH"
    | "APPROVAL_STALE",
  message: string,
): void {
  if (actual !== expected)
    throw new DraftOperationError(code, message, { expected, actual });
}

function relativeAssetPaths(manifest: JsonObject): string[] {
  const assets = manifest.assets;
  if (!Array.isArray(assets))
    throw new DraftOperationError(
      "SOURCE_ARTIFACT_INVALID",
      "assets-manifest.json assets must be an array",
    );
  const paths = new Set<string>();
  for (const [index, rawAsset] of assets.entries()) {
    if (!rawAsset || typeof rawAsset !== "object" || Array.isArray(rawAsset))
      throw new DraftOperationError(
        "SOURCE_ARTIFACT_INVALID",
        "Asset manifest entry must be an object",
        { index },
      );
    const asset = rawAsset as JsonObject;
    if (asset.rights_status !== "approved")
      throw new DraftOperationError(
        "ASSET_RIGHTS_NOT_APPROVED",
        "Every snapshot asset must have rights_status=approved",
        { asset_id: asset.asset_id ?? `index-${index}` },
      );
    const localPath = stringField(asset, "local_path", `assets[${index}]`);
    const claimed = stringField(asset, "sha256", `assets[${index}]`);
    const mime = stringField(asset, "mime_type", `assets[${index}]`);
    if (!isSha256(claimed) || !mime.startsWith("image/"))
      throw new DraftOperationError(
        "SOURCE_ARTIFACT_INVALID",
        "Asset hash and image MIME metadata are required",
        { asset_id: asset.asset_id ?? `index-${index}` },
      );
    paths.add(localPath.replace(/\\/gu, "/"));
    if (typeof asset.normalized_path === "string")
      paths.add(asset.normalized_path.replace(/\\/gu, "/"));
    if (
      typeof asset.original_reference === "string" &&
      !/^https?:\/\//iu.test(asset.original_reference)
    )
      paths.add(asset.original_reference.replace(/\\/gu, "/"));
    const transformations = Array.isArray(asset.transformations)
      ? asset.transformations
      : [];
    for (const transformation of transformations) {
      if (
        transformation &&
        typeof transformation === "object" &&
        typeof (transformation as JsonObject).output_path === "string"
      )
        paths.add(
          ((transformation as JsonObject).output_path as string).replace(
            /\\/gu,
            "/",
          ),
        );
    }
    const outputs = Array.isArray(asset.build_outputs)
      ? asset.build_outputs
      : [];
    for (const output of outputs) {
      if (
        output &&
        typeof output === "object" &&
        typeof (output as JsonObject).path === "string"
      )
        paths.add(((output as JsonObject).path as string).replace(/\\/gu, "/"));
    }
  }
  return [...paths].sort();
}

function claimedAssetHashes(manifest: JsonObject): Map<string, string> {
  const claims = new Map<string, string>();
  for (const rawAsset of manifest.assets as JsonObject[]) {
    const local = String(rawAsset.local_path).replace(/\\/gu, "/");
    claims.set(local, String(rawAsset.sha256));
    if (typeof rawAsset.normalized_path === "string")
      claims.set(
        rawAsset.normalized_path.replace(/\\/gu, "/"),
        String(rawAsset.sha256),
      );
    for (const transformation of Array.isArray(rawAsset.transformations)
      ? rawAsset.transformations
      : []) {
      const item = transformation as JsonObject;
      if (
        typeof item.output_path === "string" &&
        typeof item.output_sha256 === "string"
      )
        claims.set(item.output_path.replace(/\\/gu, "/"), item.output_sha256);
    }
    for (const output of Array.isArray(rawAsset.build_outputs)
      ? rawAsset.build_outputs
      : []) {
      const item = output as JsonObject;
      if (typeof item.path === "string" && typeof item.sha256 === "string")
        claims.set(item.path.replace(/\\/gu, "/"), item.sha256);
    }
  }
  return claims;
}

async function loadAssets(
  articleDirectory: string,
  manifest: JsonObject,
): Promise<AssetSource[]> {
  const canonicalRoot = await realpath(articleDirectory);
  const claims = claimedAssetHashes(manifest);
  const result: AssetSource[] = [];
  for (const relativePath of relativeAssetPaths(manifest)) {
    const lexical = resolveChild(articleDirectory, relativePath);
    const canonical = await realpath(lexical).catch(() => {
      throw new DraftOperationError(
        "ASSET_FILE_INVALID",
        "A manifest asset is missing",
        { path: relativePath },
      );
    });
    resolveInside(canonicalRoot, canonical, relativePath);
    const bytes = await readRequired(canonical, relativePath);
    const claimed = claims.get(relativePath);
    if (claimed && sha256(bytes) !== claimed)
      throw new DraftOperationError(
        "ASSET_FILE_INVALID",
        "A manifest asset hash does not match the file",
        { path: relativePath },
      );
    result.push({
      sourceRelativePath: relativePath,
      snapshotRelativePath: relativePath,
      bytes,
    });
  }
  return result;
}

function assetReferences(asset: JsonObject): string[] {
  return [
    asset.original_reference,
    asset.local_path,
    asset.normalized_path,
    ...(Array.isArray(asset.transformations)
      ? asset.transformations.map((item) => (item as JsonObject).output_path)
      : []),
    ...(Array.isArray(asset.build_outputs)
      ? asset.build_outputs.map((item) => (item as JsonObject).path)
      : []),
  ].filter((item): item is string => typeof item === "string");
}

function assetMetadata(
  manifest: JsonObject,
  wechatHtml: string,
  coverReference?: string,
): {
  coverAssetId: string;
  bodyImageCount: number;
} {
  const assets = manifest.assets as JsonObject[];
  if (!assets.length)
    throw new DraftOperationError(
      "SOURCE_ARTIFACT_INVALID",
      "At least one approved image asset is required",
    );
  const cover =
    assets.find((asset) => asset.asset_id === coverReference) ??
    assets.find((asset) => asset.original_reference === coverReference) ??
    assets[0];
  const imageReferences = new Set(
    [...wechatHtml.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/giu)].map(
      (match) => match[1],
    ),
  );
  const bodyAssets = assets.filter((asset) =>
    assetReferences(asset).some((reference) => imageReferences.has(reference)),
  );
  const unmatchedReferences = [...imageReferences].filter(
    (reference) =>
      !assets.some((asset) => assetReferences(asset).includes(reference)),
  );
  if (unmatchedReferences.length)
    throw new DraftOperationError(
      "SOURCE_ARTIFACT_INVALID",
      "Every compatible HTML image must map to a manifest asset",
      { unmatched_references: unmatchedReferences },
    );
  return {
    coverAssetId: stringField(cover, "asset_id", "cover asset"),
    bodyImageCount: bodyAssets.length,
  };
}

export async function validateReleaseSource(input: {
  workspaceRoot: string;
  articleDirectory: string;
  accountAlias: string;
  sourceCommit: string;
  adapterVersion: string;
  platformContractVersion: string;
  title?: string;
  coverAssetId?: string;
}): Promise<ValidatedReleaseSource> {
  const workspaceRoot = path.resolve(input.workspaceRoot);
  const lexicalArticleDirectory = resolveInside(
    workspaceRoot,
    input.articleDirectory,
    "articleDirectory",
  );
  const [canonicalWorkspaceRoot, articleDirectory] = await Promise.all([
    realpath(workspaceRoot),
    realpath(lexicalArticleDirectory).catch(() => {
      throw new DraftOperationError(
        "SOURCE_ARTIFACT_MISSING",
        "articleDirectory does not exist",
      );
    }),
  ]);
  resolveInside(canonicalWorkspaceRoot, articleDirectory, "articleDirectory");
  const locations = {
    "article.md": path.join(articleDirectory, "article.md"),
    "article.wechat.html": path.join(
      articleDirectory,
      "build",
      "article.wechat.html",
    ),
    "article.meta.json": path.join(
      articleDirectory,
      "build",
      "article.meta.json",
    ),
    "lint-report.json": path.join(
      articleDirectory,
      "build",
      "lint-report.json",
    ),
    "assets-manifest.json": path.join(
      articleDirectory,
      "assets",
      "manifest.json",
    ),
    "preview-report.json": path.join(
      articleDirectory,
      "build",
      "preview-report.json",
    ),
  } as const;
  const criticalFiles = new Map<string, Uint8Array>();
  await Promise.all(
    Object.entries(locations).map(async ([name, location]) => {
      criticalFiles.set(name, await readRequired(location, name));
    }),
  );
  const articleSource = Buffer.from(criticalFiles.get("article.md")!).toString(
    "utf8",
  );
  const meta = parseJson(
    criticalFiles.get("article.meta.json")!,
    "article.meta.json",
  );
  const lint = parseJson(
    criticalFiles.get("lint-report.json")!,
    "lint-report.json",
  );
  const manifest = parseJson(
    criticalFiles.get("assets-manifest.json")!,
    "assets-manifest.json",
  );
  const preview = parseJson(
    criticalFiles.get("preview-report.json")!,
    "preview-report.json",
  );
  if (frontmatterField(articleSource, "status") !== "approved")
    throw new DraftOperationError(
      "ARTICLE_NOT_APPROVED",
      "The current article status must be approved",
    );

  const articleId = stringField(meta, "article_id", "article.meta.json");
  requireEqual(
    frontmatterField(articleSource, "id") ?? "",
    articleId,
    "BUILD_SOURCE_MISMATCH",
    "The article id differs between source and build metadata",
  );
  const sourceHash = approvalSourceHash(articleSource);
  const renderedHash = stringField(
    meta,
    "rendered_html_hash",
    "article.meta.json",
  );
  const wechatHash = sha256(criticalFiles.get("article.wechat.html")!);
  const manifestHash = sha256(criticalFiles.get("assets-manifest.json")!);
  const lintHash = sha256(criticalFiles.get("lint-report.json")!);
  const previewHash = sha256(criticalFiles.get("preview-report.json")!);
  const themeHash = stringField(meta, "theme_hash", "article.meta.json");
  requireEqual(
    stringField(meta, "source_hash", "article.meta.json"),
    sourceHash,
    "BUILD_SOURCE_MISMATCH",
    "The build does not match the current source",
  );
  requireEqual(
    stringField(meta, "wechat_html_hash", "article.meta.json"),
    wechatHash,
    "BUILD_ARTIFACT_HASH_MISMATCH",
    "The current compatible HTML hash differs from build metadata",
  );
  const renderedCandidatePath = path.join(
    articleDirectory,
    "build",
    "article.safe.html",
  );
  const renderedBytes = await readRequired(
    renderedCandidatePath,
    "article.safe.html",
  );
  requireEqual(
    sha256(renderedBytes),
    renderedHash,
    "BUILD_ARTIFACT_HASH_MISMATCH",
    "The current rendered HTML differs from build metadata",
  );
  criticalFiles.set("article.rendered.html", renderedBytes);

  const summaryErrors =
    lint.summary && typeof lint.summary === "object"
      ? numberField(
          lint.summary as JsonObject,
          "errors",
          "lint-report.json.summary",
        )
      : Number.NaN;
  const errors =
    typeof lint.error_count === "number" ? lint.error_count : summaryErrors;
  if (
    !Number.isInteger(errors) ||
    errors !== 0 ||
    !Number.isInteger(summaryErrors) ||
    summaryErrors !== 0 ||
    lint.passed === false ||
    lint.publish_blocked === true
  )
    throw new DraftOperationError(
      "LINTER_ERRORS",
      "Deterministic lint must report zero ERROR diagnostics",
      { error_count: errors },
    );
  requireEqual(
    stringField(lint, "source_hash", "lint-report.json"),
    sourceHash,
    "LINT_SOURCE_MISMATCH",
    "The lint report is stale for the current source",
  );
  requireEqual(
    stringField(lint, "rendered_html_hash", "lint-report.json"),
    renderedHash,
    "LINT_RENDER_MISMATCH",
    "The lint report is stale for the current rendered HTML",
  );
  requireEqual(
    stringField(preview, "source_hash", "preview-report.json"),
    sourceHash,
    "PREVIEW_SOURCE_MISMATCH",
    "The preview report is stale for the current source",
  );
  requireEqual(
    stringField(preview, "rendered_html_hash", "preview-report.json"),
    renderedHash,
    "PREVIEW_RENDER_MISMATCH",
    "The preview report is stale for the current rendered HTML",
  );
  const stageHashes = preview.stage_hashes;
  if (
    !stageHashes ||
    typeof stageHashes !== "object" ||
    Array.isArray(stageHashes)
  )
    throw new DraftOperationError(
      "SOURCE_ARTIFACT_INVALID",
      "preview-report.json.stage_hashes is required",
    );
  requireEqual(
    stringField(
      stageHashes as JsonObject,
      "wechat",
      "preview-report.json.stage_hashes",
    ),
    wechatHash,
    "PREVIEW_WECHAT_MISMATCH",
    "The preview report is stale for the current compatible HTML",
  );
  if (!Array.isArray(preview.screenshot) || preview.screenshot.length === 0)
    throw new DraftOperationError(
      "SOURCE_ARTIFACT_INVALID",
      "The preview report must contain at least one current screenshot",
    );

  const approvalsRaw = Buffer.from(
    await readRequired(
      path.join(articleDirectory, "history", "approvals.jsonl"),
      "approvals.jsonl",
    ),
  ).toString("utf8");
  const invalidationsRaw = await readFile(
    path.join(articleDirectory, "history", "approval-invalidations.jsonl"),
    "utf8",
  ).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  const approvals = jsonLines<ApprovalRecord>(approvalsRaw, "approvals.jsonl");
  const invalidations = jsonLines<JsonObject>(
    invalidationsRaw,
    "approval-invalidations.jsonl",
  );
  verifyHashChain(approvals, "approval_id", "approvals.jsonl");
  verifyHashChain(
    invalidations,
    "invalidation_id",
    "approval-invalidations.jsonl",
  );
  const invalidated = new Set(
    invalidations.map((record) => String(record.previous_approval_id)),
  );
  const approval = [...approvals]
    .reverse()
    .find((record) => !invalidated.has(record.approval_id));
  if (!approval)
    throw new DraftOperationError(
      "APPROVAL_INVALID",
      "No active approval exists for the article",
    );
  const approvalChecklistKeys = [
    "content_read",
    "title_summary_confirmed",
    "facts_citations_checked",
    "image_sources_checked",
    "image_rights_checked",
    "mobile_preview_checked",
    "dark_mode_checked",
    "account_confirmed",
    "no_sensitive_information",
    "no_unfinished_placeholders",
  ];
  if (
    approval.result !== "approved" ||
    approval.reviewer_type !== "human" ||
    !approval.checklist ||
    typeof approval.checklist !== "object" ||
    approvalChecklistKeys.some(
      (key) => (approval.checklist as JsonObject)[key] !== true,
    )
  )
    throw new DraftOperationError(
      "APPROVAL_INVALID",
      "The active approval is not a complete human content approval",
    );
  const approvalBindings: Array<[string, string]> = [
    ["article_id", articleId],
    ["source_hash", sourceHash],
    ["rendered_html_hash", renderedHash],
    ["wechat_html_hash", wechatHash],
    ["lint_report_hash", lintHash],
    ["assets_manifest_hash", manifestHash],
    ["theme_hash", themeHash],
    ["source_commit", input.sourceCommit],
  ];
  for (const [key, expected] of approvalBindings)
    requireEqual(
      String(approval[key] ?? ""),
      expected,
      "APPROVAL_STALE",
      `The active approval no longer matches ${key}`,
    );

  const assetFiles = await loadAssets(articleDirectory, manifest);
  const metadata = assetMetadata(
    manifest,
    Buffer.from(criticalFiles.get("article.wechat.html")!).toString("utf8"),
    input.coverAssetId ?? frontmatterField(articleSource, "cover"),
  );
  const approvalBytes = Buffer.from(prettyStableJson(approval), "utf8");
  criticalFiles.set("approval-record.json", approvalBytes);
  return {
    articleDirectory,
    title:
      input.title ??
      frontmatterField(articleSource, "title") ??
      "Untitled approved article",
    binding: {
      article_id: articleId,
      account_alias: input.accountAlias,
      source_hash: sourceHash,
      rendered_html_hash: renderedHash,
      wechat_html_hash: wechatHash,
      assets_manifest_hash: manifestHash,
      lint_report_hash: lintHash,
      preview_report_hash: previewHash,
      approval_id: approval.approval_id,
      approval_record_hash: sha256(approvalBytes),
      theme_hash: themeHash,
      source_commit: input.sourceCommit,
      adapter_version: input.adapterVersion,
      platform_contract_version: input.platformContractVersion,
    },
    coverAssetId: input.coverAssetId ?? metadata.coverAssetId,
    bodyImageCount: metadata.bodyImageCount,
    criticalFiles,
    assetFiles,
    approvalRecord: approval,
  };
}
