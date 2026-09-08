import { createHash, randomBytes } from "node:crypto";
import {
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { MediaError } from "./media.js";
import type {
  AssetManifest,
  AssetManifestEntry,
  AssetRightsStatus,
  AssetSourceType,
  AssetUploadStatus,
  ManifestValidationIssue,
  RightsVerificationResult,
} from "./pipeline-types.js";

export const ASSET_MANIFEST_RELATIVE_PATH = "assets/manifest.json";

const sourceTypes: ReadonlySet<AssetSourceType> = new Set([
  "local",
  "remote",
  "generated",
  "user_owned",
  "project_asset",
]);
const rightsStatuses: ReadonlySet<AssetRightsStatus> = new Set([
  "approved",
  "pending",
  "blocked",
  "unknown",
]);
const uploadStatuses: ReadonlySet<AssetUploadStatus> = new Set([
  "not_uploaded",
  "pending",
  "uploaded",
  "failed",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function rejectDangerousKeys(value: unknown): void {
  if (!value || typeof value !== "object") return;
  for (const key of Object.keys(value)) {
    if (key === "__proto__" || key === "prototype" || key === "constructor") {
      throw new MediaError(
        "MANIFEST_INJECTION",
        `Dangerous manifest key ${key} is forbidden.`,
      );
    }
    rejectDangerousKeys((value as Record<string, unknown>)[key]);
  }
}

function ensureInside(root: string, candidate: string): void {
  const relative = path.relative(root, candidate);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new MediaError(
      "MANIFEST_PATH_INJECTION",
      "Manifest path escaped the article directory.",
    );
  }
}

async function secureManifestPath(
  articleDirectory: string,
  createAssets: boolean,
): Promise<string> {
  const root = await realpath(path.resolve(articleDirectory));
  const assetsCandidate = path.join(root, "assets");
  let assetsDirectory: string;
  try {
    assetsDirectory = await realpath(assetsCandidate);
  } catch (cause) {
    if (
      !(
        cause instanceof Error &&
        "code" in cause &&
        (cause as NodeJS.ErrnoException).code === "ENOENT"
      ) ||
      !createAssets
    )
      throw cause;
    await mkdir(assetsCandidate);
    assetsDirectory = await realpath(assetsCandidate);
  }
  ensureInside(root, assetsDirectory);
  if (!(await stat(assetsDirectory)).isDirectory()) {
    throw new MediaError(
      "ASSETS_NOT_DIRECTORY",
      "Article assets path is not a directory.",
    );
  }
  const target = path.join(assetsDirectory, "manifest.json");
  try {
    const existing = await realpath(target);
    ensureInside(root, existing);
    if (!(await stat(existing)).isFile())
      throw new MediaError("INVALID_MANIFEST", "Manifest path is not a file.");
    return existing;
  } catch (cause) {
    if (
      !(
        cause instanceof Error &&
        "code" in cause &&
        (cause as NodeJS.ErrnoException).code === "ENOENT"
      )
    )
      throw cause;
    return target;
  }
}

function assertString(value: unknown, field: string, allowNull = false): void {
  if ((allowNull && value === null) || typeof value === "string") return;
  throw new MediaError(
    "INVALID_MANIFEST",
    `Manifest field ${field} must be a string${allowNull ? " or null" : ""}.`,
  );
}

function assertSafeRelativePath(
  value: unknown,
  prefix: string,
  field: string,
): void {
  assertString(value, field);
  const candidate = value as string;
  if (
    candidate.includes("\0") ||
    candidate.includes("\\") ||
    path.posix.isAbsolute(candidate) ||
    candidate.split("/").includes("..") ||
    !candidate.startsWith(prefix)
  ) {
    throw new MediaError(
      "MANIFEST_PATH_INJECTION",
      `Manifest field ${field} is outside ${prefix}.`,
    );
  }
}

function validateEntry(
  value: unknown,
  index: number,
): asserts value is AssetManifestEntry {
  if (!isRecord(value))
    throw new MediaError(
      "INVALID_MANIFEST",
      `Asset ${index} must be an object.`,
    );
  const field = (name: string) => `assets[${index}].${name}`;
  for (const name of [
    "asset_id",
    "original_reference",
    "sha256",
    "mime_type",
    "imported_at",
    "imported_by",
  ] as const) {
    assertString(value[name], field(name));
  }
  if (!/^asset-[a-f0-9]{16,64}$/.test(String(value.asset_id))) {
    throw new MediaError(
      "INVALID_MANIFEST",
      `${field("asset_id")} is invalid.`,
    );
  }
  if (!/^[a-f0-9]{64}$/.test(String(value.sha256))) {
    throw new MediaError("INVALID_MANIFEST", `${field("sha256")} is invalid.`);
  }
  assertSafeRelativePath(
    value.local_path,
    "assets/originals/",
    field("local_path"),
  );
  assertSafeRelativePath(
    value.normalized_path,
    "assets/originals/",
    field("normalized_path"),
  );
  assertString(value.source_url, field("source_url"), true);
  assertString(value.license, field("license"), true);
  assertString(value.creator, field("creator"), true);
  assertString(value.attribution, field("attribution"), true);
  if (value.generation_method !== undefined)
    assertString(value.generation_method, field("generation_method"), true);
  if (!sourceTypes.has(value.source_type as AssetSourceType)) {
    throw new MediaError(
      "INVALID_MANIFEST_ENUM",
      `${field("source_type")} is invalid.`,
    );
  }
  if (value.source_type === "remote") {
    if (
      typeof value.source_url !== "string" ||
      !/^https?:\/\//i.test(value.source_url)
    ) {
      throw new MediaError(
        "INVALID_MANIFEST",
        `${field("source_url")} must be HTTP(S) for remote assets.`,
      );
    }
  }
  if (
    value.source_type === "generated" &&
    (typeof value.generation_method !== "string" ||
      !value.generation_method.trim())
  ) {
    throw new MediaError(
      "INVALID_MANIFEST",
      `${field("generation_method")} is required for generated assets.`,
    );
  }
  if (!rightsStatuses.has(value.rights_status as AssetRightsStatus)) {
    throw new MediaError(
      "INVALID_MANIFEST_ENUM",
      `${field("rights_status")} is invalid.`,
    );
  }
  if (!uploadStatuses.has(value.upload_status as AssetUploadStatus)) {
    throw new MediaError(
      "INVALID_MANIFEST_ENUM",
      `${field("upload_status")} is invalid.`,
    );
  }
  for (const name of ["file_size", "width", "height"] as const) {
    if (!Number.isSafeInteger(value[name]) || Number(value[name]) < 0) {
      throw new MediaError(
        "INVALID_MANIFEST",
        `${field(name)} must be a non-negative integer.`,
      );
    }
  }
  for (const name of [
    "animated",
    "has_alpha",
    "exif_present",
    "gps_metadata_present",
  ] as const) {
    if (typeof value[name] !== "boolean")
      throw new MediaError(
        "INVALID_MANIFEST",
        `${field(name)} must be boolean.`,
      );
  }
  if (
    !Array.isArray(value.warnings) ||
    !value.warnings.every((item) => typeof item === "string")
  ) {
    throw new MediaError(
      "INVALID_MANIFEST",
      `${field("warnings")} must be a string array.`,
    );
  }
  if (
    !Array.isArray(value.transformations) ||
    !Array.isArray(value.build_outputs)
  ) {
    throw new MediaError(
      "INVALID_MANIFEST",
      `${field("transformations")} and build_outputs must be arrays.`,
    );
  }
  for (const [
    transformationIndex,
    transformation,
  ] of value.transformations.entries()) {
    if (!isRecord(transformation))
      throw new MediaError(
        "INVALID_MANIFEST",
        `${field("transformations")}[${transformationIndex}] is invalid.`,
      );
    assertSafeRelativePath(
      transformation.output_path,
      "build/assets/",
      `${field("transformations")}[${transformationIndex}].output_path`,
    );
    for (const hashField of ["input_sha256", "output_sha256"] as const) {
      if (
        typeof transformation[hashField] !== "string" ||
        !/^[a-f0-9]{64}$/.test(transformation[hashField] as string)
      ) {
        throw new MediaError(
          "INVALID_MANIFEST",
          `${field("transformations")}[${transformationIndex}].${hashField} is invalid.`,
        );
      }
    }
    if (
      !new Set([
        "copy",
        "reencode",
        "resize",
        "privacy_cleanup",
        "cover_crop",
      ]).has(String(transformation.type))
    ) {
      throw new MediaError(
        "INVALID_MANIFEST_ENUM",
        `${field("transformations")}[${transformationIndex}].type is invalid.`,
      );
    }
    for (const numberField of ["file_size", "width", "height"] as const) {
      if (
        !Number.isSafeInteger(transformation[numberField]) ||
        Number(transformation[numberField]) < 0
      ) {
        throw new MediaError(
          "INVALID_MANIFEST",
          `${field("transformations")}[${transformationIndex}].${numberField} is invalid.`,
        );
      }
    }
    if (typeof transformation.privacy_metadata_removed !== "boolean") {
      throw new MediaError(
        "INVALID_MANIFEST",
        `${field("transformations")}[${transformationIndex}].privacy_metadata_removed is invalid.`,
      );
    }
  }
  for (const [outputIndex, output] of value.build_outputs.entries()) {
    if (!isRecord(output))
      throw new MediaError(
        "INVALID_MANIFEST",
        `${field("build_outputs")}[${outputIndex}] is invalid.`,
      );
    assertSafeRelativePath(
      output.path,
      "build/assets/",
      `${field("build_outputs")}[${outputIndex}].path`,
    );
    if (
      typeof output.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(output.sha256)
    ) {
      throw new MediaError(
        "INVALID_MANIFEST",
        `${field("build_outputs")}[${outputIndex}].sha256 is invalid.`,
      );
    }
    if (output.purpose !== "article" && output.purpose !== "cover_preview") {
      throw new MediaError(
        "INVALID_MANIFEST_ENUM",
        `${field("build_outputs")}[${outputIndex}].purpose is invalid.`,
      );
    }
    for (const numberField of ["file_size", "width", "height"] as const) {
      if (
        !Number.isSafeInteger(output[numberField]) ||
        Number(output[numberField]) < 0
      ) {
        throw new MediaError(
          "INVALID_MANIFEST",
          `${field("build_outputs")}[${outputIndex}].${numberField} is invalid.`,
        );
      }
    }
  }
}

export function validateAssetManifest(value: unknown): AssetManifest {
  rejectDangerousKeys(value);
  if (!isRecord(value) || value.schema_version !== "1") {
    throw new MediaError(
      "INVALID_MANIFEST",
      "Asset manifest schema_version must be 1.",
    );
  }
  assertString(value.article_id, "article_id");
  assertString(value.generated_at, "generated_at");
  if (!Array.isArray(value.assets))
    throw new MediaError(
      "INVALID_MANIFEST",
      "Manifest assets must be an array.",
    );
  value.assets.forEach(validateEntry);
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const asset of value.assets) {
    if (ids.has(asset.asset_id))
      throw new MediaError(
        "DUPLICATE_ASSET_ID",
        `Duplicate asset id ${asset.asset_id}.`,
      );
    if (paths.has(asset.normalized_path))
      throw new MediaError(
        "DUPLICATE_ASSET_PATH",
        `Duplicate asset path ${asset.normalized_path}.`,
      );
    ids.add(asset.asset_id);
    paths.add(asset.normalized_path);
  }
  return value as unknown as AssetManifest;
}

export function createEmptyAssetManifest(articleId: string): AssetManifest {
  const normalized = articleId.trim();
  if (!normalized || normalized.includes("\0"))
    throw new MediaError("INVALID_ARTICLE_ID", "Article id is required.");
  return {
    schema_version: "1",
    article_id: normalized,
    generated_at: new Date().toISOString(),
    assets: [],
  };
}

export function assetManifestPath(articleDirectory: string): string {
  return path.join(
    path.resolve(articleDirectory),
    ...ASSET_MANIFEST_RELATIVE_PATH.split("/"),
  );
}

export async function readAssetManifest(
  articleDirectory: string,
): Promise<AssetManifest> {
  let manifestPath: string;
  let source: string;
  try {
    manifestPath = await secureManifestPath(articleDirectory, false);
    if ((await stat(manifestPath)).size > 2 * 1024 * 1024) {
      throw new MediaError(
        "MANIFEST_TOO_LARGE",
        "Asset manifest exceeds the 2 MiB safety limit.",
      );
    }
    source = await readFile(manifestPath, "utf8");
  } catch (cause) {
    if (
      cause instanceof Error &&
      "code" in cause &&
      (cause as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return createEmptyAssetManifest(
        path.basename(path.resolve(articleDirectory)),
      );
    }
    throw cause;
  }
  try {
    return validateAssetManifest(JSON.parse(source) as unknown);
  } catch (cause) {
    if (cause instanceof MediaError) throw cause;
    throw new MediaError(
      "INVALID_MANIFEST_JSON",
      "Asset manifest is not valid JSON.",
      { cause },
    );
  }
}

function canonicalManifest(manifest: AssetManifest): AssetManifest {
  return {
    ...manifest,
    generated_at: new Date().toISOString(),
    assets: [...manifest.assets]
      .map((asset) => ({
        ...asset,
        warnings: [...new Set(asset.warnings)].sort(),
        transformations: [...asset.transformations],
        build_outputs: [...asset.build_outputs],
      }))
      .sort((left, right) => left.asset_id.localeCompare(right.asset_id)),
  };
}

export async function writeAssetManifest(
  articleDirectory: string,
  manifest: AssetManifest,
  options: { expectedSha256?: string } = {},
): Promise<AssetManifest> {
  validateAssetManifest(manifest);
  const target = await secureManifestPath(articleDirectory, true);
  if (options.expectedSha256) {
    const existing = await readFile(target).catch(() => undefined);
    const actual = existing
      ? createHash("sha256").update(existing).digest("hex")
      : "missing";
    if (actual !== options.expectedSha256)
      throw new MediaError(
        "MANIFEST_CONFLICT",
        "Asset manifest changed since it was read.",
      );
  }
  const normalized = canonicalManifest(manifest);
  const bytes = Buffer.from(`${JSON.stringify(normalized, null, 2)}\n`);
  const temporary = path.join(
    path.dirname(target),
    `.manifest-${randomBytes(8).toString("hex")}.tmp`,
  );
  await writeFile(temporary, bytes, { flag: "wx" });
  try {
    await rename(temporary, target);
  } catch (cause) {
    await rm(temporary, { force: true });
    throw new MediaError(
      "MANIFEST_WRITE_FAILED",
      "Could not atomically update asset manifest.",
      { cause },
    );
  }
  return normalized;
}

export function hashAssetManifest(manifest: AssetManifest): string {
  return createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
}

function licenseRequiresAttribution(license: string | null): boolean {
  return Boolean(
    license && /(?:CC[- ]?BY|attribution|required attribution)/i.test(license),
  );
}

export function verifyAssetRights(
  manifest: AssetManifest,
): RightsVerificationResult {
  validateAssetManifest(manifest);
  const issues: ManifestValidationIssue[] = [];
  for (const asset of manifest.assets) {
    if (asset.rights_status !== "approved") {
      issues.push({
        code: `RIGHTS_${asset.rights_status.toUpperCase()}`,
        message: `Asset ${asset.asset_id} rights_status is ${asset.rights_status}; only approved is publish-ready.`,
        assetId: asset.asset_id,
        blocking: true,
      });
    }
    if (asset.source_type === "remote" && !asset.source_url) {
      issues.push({
        code: "REMOTE_SOURCE_URL_REQUIRED",
        message: `Remote asset ${asset.asset_id} has no source_url.`,
        assetId: asset.asset_id,
        blocking: true,
      });
    }
    if (asset.source_type === "generated" && !asset.generation_method?.trim()) {
      issues.push({
        code: "GENERATION_METHOD_REQUIRED",
        message: `Generated asset ${asset.asset_id} has no generation method.`,
        assetId: asset.asset_id,
        blocking: true,
      });
    }
    if (
      licenseRequiresAttribution(asset.license) &&
      !asset.attribution?.trim()
    ) {
      issues.push({
        code: "ATTRIBUTION_REQUIRED",
        message: `Asset ${asset.asset_id} license requires attribution.`,
        assetId: asset.asset_id,
        blocking: true,
      });
    }
    if (!asset.creator?.trim()) {
      issues.push({
        code: "CREATOR_UNKNOWN",
        message: `Asset ${asset.asset_id} creator is unknown.`,
        assetId: asset.asset_id,
        blocking: false,
      });
    }
  }
  return { publishReady: issues.every((issue) => !issue.blocking), issues };
}
