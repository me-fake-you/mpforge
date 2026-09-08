import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import {
  extensionForImageMime,
  inspectImageBytes,
  type InspectImageOptions,
} from "./image-inspection.js";
import {
  assetManifestPath,
  createEmptyAssetManifest,
  readAssetManifest,
  verifyAssetRights,
  writeAssetManifest,
} from "./manifest.js";
import {
  scanMarkdownImageReferences,
  type MarkdownImageReference,
} from "./markdown-images.js";
import {
  MediaError,
  resolveLocalImageReference,
  resolveProjectChromiumExecutable,
} from "./media.js";
import {
  nodeSecureRemoteFetcher,
  securelyFetchRemoteImage,
  type SecureRemoteFetcher,
  type SecureRemoteFetchPolicy,
} from "./network-security.js";
import type {
  AssetBuildOutput,
  AssetImportMetadata,
  AssetManifest,
  AssetManifestEntry,
  AssetRightsInput,
  AssetSourceType,
  AssetTransformation,
  InspectedImage,
  ManifestValidationIssue,
  MediaSecurityPolicy,
  RightsVerificationResult,
} from "./pipeline-types.js";

const ORIGINALS_DIRECTORY = "assets/originals";
const BUILD_ASSETS_DIRECTORY = "build/assets";

function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

function ensureInside(root: string, candidate: string, code: string): void {
  const relative = path.relative(root, candidate);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new MediaError(code, "Media path escaped the article directory.");
  }
}

async function secureSubdirectory(
  articleDirectory: string,
  relative: string,
): Promise<{ root: string; directory: string }> {
  const root = await realpath(path.resolve(articleDirectory)).catch((cause) => {
    throw new MediaError(
      "ARTICLE_DIRECTORY_MISSING",
      "Article directory does not exist.",
      { cause },
    );
  });
  let directory = root;
  for (const component of relative.split("/")) {
    const candidate = path.join(directory, component);
    ensureInside(root, candidate, "PATH_TRAVERSAL");
    try {
      directory = await realpath(candidate);
    } catch (cause) {
      if (
        !(
          cause instanceof Error &&
          "code" in cause &&
          (cause as NodeJS.ErrnoException).code === "ENOENT"
        )
      )
        throw cause;
      await mkdir(candidate);
      directory = await realpath(candidate);
    }
    ensureInside(root, directory, "SYMLINK_ESCAPE");
    if (!(await stat(directory)).isDirectory()) {
      throw new MediaError(
        "MEDIA_DIRECTORY_INVALID",
        `${relative} is not a directory.`,
      );
    }
  }
  return { root, directory };
}

async function writeContentAddressed(
  directory: string,
  data: Uint8Array,
  hash: string,
  extension: string,
): Promise<{ absolutePath: string; created: boolean }> {
  const absolutePath = path.join(directory, `${hash}${extension}`);
  try {
    await writeFile(absolutePath, data, { flag: "wx" });
    return { absolutePath, created: true };
  } catch (cause) {
    if (
      !(
        cause instanceof Error &&
        "code" in cause &&
        (cause as NodeJS.ErrnoException).code === "EEXIST"
      )
    )
      throw cause;
    const existing = await readFile(absolutePath);
    if (
      sha256(existing) !== hash ||
      !Buffer.from(existing).equals(Buffer.from(data))
    ) {
      throw new MediaError(
        "HASH_COLLISION",
        "Content-addressed image path contains different bytes.",
      );
    }
    return { absolutePath, created: false };
  }
}

function validateImportMetadata(metadata: AssetImportMetadata): {
  sourceType: AssetSourceType;
  rightsStatus: AssetManifestEntry["rights_status"];
} {
  if (!metadata.importedBy?.trim() || metadata.importedBy.includes("\0")) {
    throw new MediaError(
      "IMPORTED_BY_REQUIRED",
      "Asset importer identity is required.",
    );
  }
  const sourceType = metadata.sourceType ?? "local";
  if (sourceType === "user_owned" && metadata.userOwnedConfirmed !== true) {
    throw new MediaError(
      "USER_OWNERSHIP_UNCONFIRMED",
      "User-owned assets require explicit confirmation.",
    );
  }
  if (sourceType === "generated" && !metadata.generationMethod?.trim()) {
    throw new MediaError(
      "GENERATION_METHOD_REQUIRED",
      "Generated assets require a generation method.",
    );
  }
  if (sourceType === "remote" && !metadata.sourceUrl?.trim()) {
    throw new MediaError(
      "REMOTE_SOURCE_URL_REQUIRED",
      "Remote assets require source_url.",
    );
  }
  if (
    metadata.rightsStatus === "approved" &&
    metadata.rightsConfirmedByHuman !== true
  ) {
    throw new MediaError(
      "HUMAN_RIGHTS_CONFIRMATION_REQUIRED",
      "An import can only start approved after explicit human rights confirmation.",
    );
  }
  return { sourceType, rightsStatus: metadata.rightsStatus ?? "pending" };
}

export interface ImportAssetBytesInput {
  originalReference: string;
  fileName: string;
  data: Uint8Array;
  declaredContentType?: string;
  metadata: AssetImportMetadata;
  policy?: MediaSecurityPolicy;
}

export interface ImportedAssetResult {
  asset: AssetManifestEntry;
  manifest: AssetManifest;
  deduplicated: boolean;
}

/** Explicitly imports bytes into immutable assets/originals and updates manifest.json. */
export async function importAssetBytes(
  articleDirectory: string,
  input: ImportAssetBytesInput,
): Promise<ImportedAssetResult> {
  const { sourceType, rightsStatus } = validateImportMetadata(input.metadata);
  if (
    !input.originalReference.trim() ||
    input.originalReference.includes("\0")
  ) {
    throw new MediaError(
      "INVALID_MEDIA_REFERENCE",
      "Original image reference is required.",
    );
  }
  const inspection = inspectImageBytes(input.data, {
    ...input.policy,
    fileName: input.fileName,
    declaredContentType: input.declaredContentType,
    rejectExtensionMismatch: true,
  });
  const digest = sha256(input.data);
  const extension = extensionForImageMime(inspection.mimeType);
  const { root, directory } = await secureSubdirectory(
    articleDirectory,
    ORIGINALS_DIRECTORY,
  );
  const localPath = `${ORIGINALS_DIRECTORY}/${digest}${extension}`;
  const written = await writeContentAddressed(
    directory,
    input.data,
    digest,
    extension,
  );
  try {
    const manifest = await readAssetManifest(root);
    const existing = manifest.assets.find((asset) => asset.sha256 === digest);
    if (existing) {
      if (!existing.warnings.includes("DUPLICATE_CONTENT"))
        existing.warnings.push("DUPLICATE_CONTENT");
      const updated = await writeAssetManifest(root, manifest);
      return { asset: existing, manifest: updated, deduplicated: true };
    }
    const warnings = [...inspection.warnings];
    if (rightsStatus !== "approved")
      warnings.push(`RIGHTS_${rightsStatus.toUpperCase()}`);
    const asset: AssetManifestEntry = {
      asset_id: `asset-${digest.slice(0, 24)}`,
      original_reference: input.originalReference,
      local_path: localPath,
      normalized_path: localPath,
      source_type: sourceType,
      source_url: input.metadata.sourceUrl ?? null,
      sha256: digest,
      mime_type: inspection.mimeType,
      file_size: inspection.fileSize,
      width: inspection.width,
      height: inspection.height,
      animated: inspection.animated,
      has_alpha: inspection.hasAlpha,
      exif_present: inspection.exifPresent,
      gps_metadata_present: inspection.gpsMetadataPresent,
      imported_at: new Date().toISOString(),
      imported_by: input.metadata.importedBy.trim(),
      rights_status: rightsStatus,
      license: input.metadata.license ?? null,
      creator: input.metadata.creator ?? null,
      attribution: input.metadata.attribution ?? null,
      generation_method: input.metadata.generationMethod ?? null,
      transformations: [],
      build_outputs: [],
      upload_status: "not_uploaded",
      warnings: [...new Set(warnings)].sort(),
    };
    manifest.assets.push(asset);
    const updated = await writeAssetManifest(root, manifest);
    return { asset, manifest: updated, deduplicated: false };
  } catch (cause) {
    if (written.created) await rm(written.absolutePath, { force: true });
    throw cause;
  }
}

export async function importLocalAsset(
  articleDirectory: string,
  reference: string,
  metadata: AssetImportMetadata,
  policy?: MediaSecurityPolicy,
): Promise<ImportedAssetResult> {
  if (metadata.sourceType === "remote")
    throw new MediaError(
      "INVALID_SOURCE_TYPE",
      "Local import cannot use source_type=remote.",
    );
  const sourcePath = await resolveLocalImageReference(
    articleDirectory,
    reference,
  );
  return importAssetBytes(articleDirectory, {
    originalReference: reference,
    fileName: path.basename(sourcePath),
    data: await readFile(sourcePath),
    metadata,
    policy,
  });
}

export interface ImportRemoteAssetOptions {
  importedBy: string;
  /** Acknowledges that rights still need explicit manifest approval. */
  rightsAcknowledged: true;
  license?: string | null;
  creator?: string | null;
  attribution?: string | null;
  fetcher?: SecureRemoteFetcher;
  fetchPolicy?: SecureRemoteFetchPolicy;
  imagePolicy?: MediaSecurityPolicy;
}

/** The only high-level API that downloads a remote image; callers must invoke it explicitly. */
export async function importRemoteAsset(
  articleDirectory: string,
  sourceUrl: string,
  options: ImportRemoteAssetOptions,
): Promise<ImportedAssetResult> {
  if (options.rightsAcknowledged !== true) {
    throw new MediaError(
      "RIGHTS_UNCONFIRMED",
      "Remote import requires an explicit rights acknowledgement.",
    );
  }
  const fetched = await securelyFetchRemoteImage(
    sourceUrl,
    options.fetcher ?? nodeSecureRemoteFetcher,
    options.fetchPolicy,
  );
  const url = new URL(fetched.finalUrl);
  const fileName = path.posix.basename(url.pathname) || "remote-image";
  return importAssetBytes(articleDirectory, {
    originalReference: sourceUrl,
    fileName,
    data: fetched.data,
    declaredContentType: fetched.contentType,
    metadata: {
      sourceType: "remote",
      sourceUrl,
      importedBy: options.importedBy,
      rightsStatus: "pending",
      license: options.license,
      creator: options.creator,
      attribution: options.attribution,
    },
    policy: options.imagePolicy,
  });
}

export interface ArticleAssetScanIssue extends ManifestValidationIssue {
  reference?: MarkdownImageReference;
}

export interface ArticleAssetScanResult {
  references: MarkdownImageReference[];
  manifest: AssetManifest;
  issues: ArticleAssetScanIssue[];
  networkRequests: 0;
}

/** Scans article.md and local registrations. It is intentionally incapable of network access. */
export async function scanArticleAssets(
  articleDirectory: string,
  options: { articleFile?: string; createManifest?: boolean } = {},
): Promise<ArticleAssetScanResult> {
  const root = await realpath(path.resolve(articleDirectory));
  const articleFile = options.articleFile ?? "article.md";
  if (
    path.isAbsolute(articleFile) ||
    articleFile.split(/[\\/]/).includes("..")
  ) {
    throw new MediaError(
      "PATH_TRAVERSAL",
      "Article file must stay inside article directory.",
    );
  }
  const articlePath = await realpath(path.join(root, articleFile));
  ensureInside(root, articlePath, "SYMLINK_ESCAPE");
  const markdown = await readFile(articlePath, "utf8");
  const references = scanMarkdownImageReferences(markdown);
  const manifest = await readAssetManifest(root);
  const issues: ArticleAssetScanIssue[] = [];
  for (const reference of references) {
    if (!reference.alt.trim()) {
      issues.push({
        code: "IMAGE_ALT_MISSING",
        message: `Image at line ${reference.line} has no alt text.`,
        reference,
        blocking: false,
      });
    }
    if (/^(?:file|data|ftp):/i.test(reference.source)) {
      issues.push({
        code: "UNSAFE_IMAGE_PROTOCOL",
        message: `Image protocol at line ${reference.line} is forbidden.`,
        reference,
        blocking: true,
      });
      continue;
    }
    if (reference.remote) {
      const registered = manifest.assets.some(
        (asset) =>
          asset.source_url === reference.source ||
          asset.original_reference === reference.source,
      );
      if (!registered)
        issues.push({
          code: "REMOTE_IMAGE_NOT_IMPORTED",
          message: `Remote image at line ${reference.line} requires explicit import.`,
          reference,
          blocking: true,
        });
      continue;
    }
    try {
      const resolved = await resolveLocalImageReference(root, reference.source);
      const digest = sha256(await readFile(resolved));
      const registered = manifest.assets.some(
        (asset) =>
          asset.sha256 === digest ||
          asset.normalized_path === reference.source.replace(/\\/g, "/"),
      );
      if (!registered)
        issues.push({
          code: "LOCAL_IMAGE_NOT_REGISTERED",
          message: `Local image at line ${reference.line} is not in manifest.`,
          reference,
          blocking: true,
        });
    } catch (cause) {
      issues.push({
        code: cause instanceof MediaError ? cause.code : "IMAGE_READ_FAILED",
        message: `Image at line ${reference.line} could not be verified.`,
        reference,
        blocking: true,
      });
    }
  }
  issues.push(...verifyAssetRights(manifest).issues);
  if (options.createManifest !== false) {
    try {
      await access(assetManifestPath(root));
    } catch {
      await writeAssetManifest(
        root,
        createEmptyAssetManifest(path.basename(root)),
      );
    }
  }
  return { references, manifest, issues, networkRequests: 0 };
}

export interface DerivedImageProcessorOptions {
  targetWidth: number;
  targetHeight: number;
  crop: boolean;
  quality: number;
}

export interface DerivedImageProcessorResult {
  data: Uint8Array;
  contentType: string;
}

export interface DerivedImageProcessor {
  process(
    data: Uint8Array,
    source: InspectedImage,
    options: DerivedImageProcessorOptions,
  ): Promise<DerivedImageProcessorResult>;
}

/** Re-encodes through project-local Chromium, removing EXIF/GPS and never fetching external resources. */
export const projectLocalDerivedImageProcessor: DerivedImageProcessor = {
  async process(data, source, options) {
    const executablePath = resolveProjectChromiumExecutable();
    if (!executablePath)
      throw new MediaError(
        "IMAGE_PROCESSOR_UNAVAILABLE",
        "Project-local Chromium is required for image re-encoding.",
      );
    const browser = await chromium.launch({ executablePath, headless: true });
    try {
      const page = await browser.newPage({
        viewport: {
          width: Math.max(1, options.targetWidth),
          height: Math.max(1, options.targetHeight),
        },
        deviceScaleFactor: 1,
      });
      await page.route(/^https?:\/\//, (route) =>
        route.abort("blockedbyclient"),
      );
      const sourceUrl = `data:${source.mimeType};base64,${Buffer.from(data).toString("base64")}`;
      await page.setContent(
        `<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}img{display:block;width:100%;height:100%;object-fit:${options.crop ? "cover" : "contain"}}</style><img alt="" src="${sourceUrl}">`,
        { waitUntil: "load" },
      );
      const output = await page.locator("img").screenshot({
        type: "png",
        omitBackground: true,
        animations: "disabled",
      });
      await page.close();
      return { data: output, contentType: "image/png" };
    } catch (cause) {
      throw new MediaError(
        "IMAGE_PROCESSING_FAILED",
        "Image re-encoding failed; original was preserved.",
        { cause },
      );
    } finally {
      await browser.close();
    }
  },
};

export interface OptimizeArticleAssetsOptions {
  maxOutputWidth?: number;
  quality?: number;
  forceReencode?: boolean;
  flattenAnimated?: boolean;
  processor?: DerivedImageProcessor;
  coverAssetId?: string;
  coverWidth?: number;
  coverHeight?: number;
  policy?: MediaSecurityPolicy;
}

export interface OptimizeArticleAssetsResult {
  manifest: AssetManifest;
  optimized: number;
  copied: number;
  originalBytes: number;
  outputBytes: number;
  warnings: string[];
}

function inspectOptions(
  fileName: string,
  policy?: MediaSecurityPolicy,
): InspectImageOptions {
  return { ...policy, fileName, rejectExtensionMismatch: true };
}

export async function optimizeArticleAssets(
  articleDirectory: string,
  options: OptimizeArticleAssetsOptions = {},
): Promise<OptimizeArticleAssetsResult> {
  const { root, directory: buildDirectory } = await secureSubdirectory(
    articleDirectory,
    BUILD_ASSETS_DIRECTORY,
  );
  const manifest = await readAssetManifest(root);
  const processor = options.processor ?? projectLocalDerivedImageProcessor;
  const maxOutputWidth = options.maxOutputWidth ?? 1200;
  const quality = options.quality ?? 82;
  const created: string[] = [];
  let optimized = 0;
  let copied = 0;
  let originalBytes = 0;
  let outputBytes = 0;
  const warnings: string[] = [];
  try {
    for (const asset of manifest.assets) {
      const originalPath = path.join(root, ...asset.normalized_path.split("/"));
      ensureInside(root, originalPath, "MANIFEST_PATH_INJECTION");
      const resolved = await realpath(originalPath);
      ensureInside(root, resolved, "SYMLINK_ESCAPE");
      const sourceBytes = await readFile(resolved);
      if (sha256(sourceBytes) !== asset.sha256)
        throw new MediaError(
          "ORIGINAL_HASH_MISMATCH",
          `Original ${asset.asset_id} no longer matches manifest.`,
        );
      const source = inspectImageBytes(
        sourceBytes,
        inspectOptions(asset.normalized_path, options.policy),
      );
      originalBytes += sourceBytes.byteLength;
      const targetWidth = Math.max(1, Math.min(source.width, maxOutputWidth));
      const targetHeight = Math.max(
        1,
        Math.round(source.height * (targetWidth / source.width)),
      );
      const needsPrivacyCleanup =
        source.exifPresent || source.gpsMetadataPresent;
      const needsResize = targetWidth < source.width;
      const shouldReencode =
        options.forceReencode === true ||
        needsPrivacyCleanup ||
        needsResize ||
        source.mimeType === "image/svg+xml" ||
        (source.animated && options.flattenAnimated === true);
      let outputData = sourceBytes as Uint8Array;
      let outputMime = source.mimeType;
      let transformationType: AssetTransformation["type"] = "copy";
      if (
        shouldReencode &&
        (!source.animated || options.flattenAnimated === true)
      ) {
        const processed = await processor.process(sourceBytes, source, {
          targetWidth,
          targetHeight,
          crop: false,
          quality,
        });
        outputData = processed.data;
        outputMime = processed.contentType;
        transformationType = needsPrivacyCleanup
          ? "privacy_cleanup"
          : needsResize
            ? "resize"
            : "reencode";
        optimized += 1;
      } else {
        copied += 1;
        if (source.animated)
          warnings.push(`${asset.asset_id}:ANIMATED_ORIGINAL_PRESERVED`);
      }
      const outputInspection = inspectImageBytes(outputData, {
        ...options.policy,
        maxWidth: Math.max(options.policy?.maxWidth ?? 10_000, targetWidth),
        maxHeight: Math.max(options.policy?.maxHeight ?? 10_000, targetHeight),
        fileName: `output${extensionForImageMime(outputMime)}`,
        declaredContentType: outputMime,
      });
      if (needsResize && outputInspection.width > source.width)
        throw new MediaError(
          "IMAGE_ENLARGED",
          "Optimization must never enlarge an image.",
        );
      const outputHash = sha256(outputData);
      const extension = extensionForImageMime(outputInspection.mimeType);
      const written = await writeContentAddressed(
        buildDirectory,
        outputData,
        outputHash,
        extension,
      );
      if (written.created) created.push(written.absolutePath);
      const outputPath = `${BUILD_ASSETS_DIRECTORY}/${outputHash}${extension}`;
      outputBytes += outputData.byteLength;
      if (
        outputData.byteLength >= sourceBytes.byteLength &&
        transformationType !== "copy"
      ) {
        warnings.push(`${asset.asset_id}:OUTPUT_NOT_SMALLER`);
      }
      const transformation: AssetTransformation = {
        type: transformationType,
        input_sha256: asset.sha256,
        output_sha256: outputHash,
        output_path: outputPath,
        mime_type: outputInspection.mimeType,
        file_size: outputInspection.fileSize,
        width: outputInspection.width,
        height: outputInspection.height,
        privacy_metadata_removed:
          transformationType !== "copy" &&
          !outputInspection.exifPresent &&
          !outputInspection.gpsMetadataPresent,
        created_at: new Date().toISOString(),
      };
      const buildOutput: AssetBuildOutput = {
        output_id: `output-${outputHash.slice(0, 24)}`,
        purpose: "article",
        path: outputPath,
        sha256: outputHash,
        mime_type: outputInspection.mimeType,
        file_size: outputInspection.fileSize,
        width: outputInspection.width,
        height: outputInspection.height,
      };
      asset.transformations = [transformation];
      asset.build_outputs = [buildOutput];

      if (options.coverAssetId === asset.asset_id) {
        const coverWidth = options.coverWidth ?? 900;
        const coverHeight = options.coverHeight ?? 383;
        const cover = await processor.process(sourceBytes, source, {
          targetWidth: Math.min(source.width, coverWidth),
          targetHeight: Math.min(source.height, coverHeight),
          crop: true,
          quality,
        });
        const coverInspection = inspectImageBytes(cover.data, {
          ...options.policy,
          fileName: `cover${extensionForImageMime(cover.contentType)}`,
          declaredContentType: cover.contentType,
        });
        const coverHash = sha256(cover.data);
        const coverExtension = extensionForImageMime(coverInspection.mimeType);
        const coverWritten = await writeContentAddressed(
          buildDirectory,
          cover.data,
          coverHash,
          coverExtension,
        );
        if (coverWritten.created) created.push(coverWritten.absolutePath);
        const coverPath = `${BUILD_ASSETS_DIRECTORY}/${coverHash}${coverExtension}`;
        asset.transformations.push({
          type: "cover_crop",
          input_sha256: asset.sha256,
          output_sha256: coverHash,
          output_path: coverPath,
          mime_type: coverInspection.mimeType,
          file_size: coverInspection.fileSize,
          width: coverInspection.width,
          height: coverInspection.height,
          privacy_metadata_removed:
            !coverInspection.exifPresent && !coverInspection.gpsMetadataPresent,
          created_at: new Date().toISOString(),
        });
        asset.build_outputs.push({
          output_id: `output-${coverHash.slice(0, 24)}`,
          purpose: "cover_preview",
          path: coverPath,
          sha256: coverHash,
          mime_type: coverInspection.mimeType,
          file_size: coverInspection.fileSize,
          width: coverInspection.width,
          height: coverInspection.height,
        });
      }
    }
    const updated = await writeAssetManifest(root, manifest);
    return {
      manifest: updated,
      optimized,
      copied,
      originalBytes,
      outputBytes,
      warnings: [...new Set(warnings)].sort(),
    };
  } catch (cause) {
    await Promise.all(created.map((file) => rm(file, { force: true })));
    throw cause;
  }
}

export interface UpdateAssetRightsOptions extends AssetRightsInput {
  /** Setting approved is a human rights assertion, never an automatic inference. */
  confirmedByHuman?: true;
}

export async function updateAssetRights(
  articleDirectory: string,
  assetId: string,
  update: UpdateAssetRightsOptions,
): Promise<{
  manifest: AssetManifest;
  verification: RightsVerificationResult;
}> {
  const manifest = await readAssetManifest(articleDirectory);
  const asset = manifest.assets.find((item) => item.asset_id === assetId);
  if (!asset)
    throw new MediaError("ASSET_NOT_FOUND", `Asset ${assetId} was not found.`);
  if (update.rightsStatus === "approved" && update.confirmedByHuman !== true) {
    throw new MediaError(
      "HUMAN_RIGHTS_CONFIRMATION_REQUIRED",
      "Only an explicit human confirmation can approve asset rights.",
    );
  }
  if (
    asset.source_type === "user_owned" &&
    update.userOwnedConfirmed !== true &&
    update.rightsStatus === "approved"
  ) {
    throw new MediaError(
      "USER_OWNERSHIP_UNCONFIRMED",
      "User ownership must be explicitly confirmed.",
    );
  }
  if (update.rightsStatus) asset.rights_status = update.rightsStatus;
  if (update.license !== undefined) asset.license = update.license;
  if (update.creator !== undefined) asset.creator = update.creator;
  if (update.attribution !== undefined) asset.attribution = update.attribution;
  if (update.generationMethod !== undefined)
    asset.generation_method = update.generationMethod;
  asset.warnings = asset.warnings.filter(
    (warning) => !warning.startsWith("RIGHTS_"),
  );
  if (asset.rights_status !== "approved")
    asset.warnings.push(`RIGHTS_${asset.rights_status.toUpperCase()}`);
  const updated = await writeAssetManifest(articleDirectory, manifest);
  return { manifest: updated, verification: verifyAssetRights(updated) };
}
