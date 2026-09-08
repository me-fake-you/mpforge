import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
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
import { chromium } from "playwright-core";
import { isIP } from "node:net";

export const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
export const DEFAULT_MAX_WIDTH = 10_000;
export const DEFAULT_MAX_HEIGHT = 10_000;
export const ASSETS_DIRECTORY = "assets";

export type ImageMimeType =
  | "image/gif"
  | "image/jpeg"
  | "image/png"
  | "image/svg+xml"
  | "image/webp";

export interface ImageDimensions {
  width: number;
  height: number;
}

export interface MediaErrorOptions {
  cause?: unknown;
}

export class MediaError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: MediaErrorOptions) {
    super(message, options);
    this.name = "MediaError";
    this.code = code;
  }
}

export interface ImagePolicy {
  maxBytes?: number;
  maxWidth?: number;
  maxHeight?: number;
  allowedMimeTypes?: ReadonlySet<ImageMimeType>;
}

export interface ImageSource {
  /** An article-local reference or an explicit import URL. */
  source: string;
  data: Uint8Array;
  contentType?: string;
}

export interface ImageTransformerOptions {
  format?: ImageMimeType;
  quality?: number;
  compressionLevel?: number;
}

/** Optional adapter for licensed image conversion/compression libraries. */
export interface ImageTransformer {
  transform(
    data: Uint8Array,
    mimeType: ImageMimeType,
    options?: ImageTransformerOptions,
  ): Promise<ImageSource> | ImageSource;
}

/** Safe default: no conversion or compression is performed. */
export const passthroughImageTransformer: ImageTransformer = {
  transform(data, mimeType) {
    return { source: "transformed", data, contentType: mimeType };
  },
};

export interface SvgSafetyReport {
  safe: boolean;
  issues: string[];
}

export interface SvgSafetyInspector {
  inspect(data: Uint8Array): SvgSafetyReport;
}

export interface SvgConverter {
  convert(
    data: Uint8Array,
    options?: ImageTransformerOptions,
  ): Promise<ImageSource> | ImageSource;
}

const unsafeSvgPatterns: readonly [RegExp, string][] = [
  [/<\s*script\b/i, "script elements are not allowed"],
  [
    /<\s*(?:iframe|object|embed|foreignObject)\b/i,
    "active or external elements are not allowed",
  ],
  [/<\s*animate(?:Transform)?\b/i, "animation elements are not allowed"],
  [/\bon[a-z]+\s*=/i, "event handler attributes are not allowed"],
  [
    /(?:href|xlink:href)\s*=\s*["']\s*(?:javascript:|https?:|\/\/)/i,
    "external or executable links are not allowed",
  ],
  [
    /(?:href|xlink:href)\s*=\s*["']\s*(?!#)[^"']+/i,
    "non-fragment resource links are not allowed",
  ],
  [
    /url\(\s*["']?\s*(?:https?:|\/\/|data:|file:)/i,
    "external CSS resources are not allowed",
  ],
  [/@import\b/i, "CSS imports are not allowed"],
  [/expression\s*\(/i, "CSS expressions are not allowed"],
  [/<\s*!DOCTYPE\b/i, "DOCTYPE declarations are not allowed"],
  [/<\s*!ENTITY\b/i, "ENTITY declarations are not allowed"],
];

export function inspectSvgSafety(data: Uint8Array): SvgSafetyReport {
  const text = Buffer.from(data).toString("utf8");
  const issues = unsafeSvgPatterns
    .filter(([pattern]) => pattern.test(text))
    .map(([, issue]) => issue);
  if (!/^\s*(?:<\?xml[^>]*>\s*)?<svg\b/i.test(text)) {
    issues.push("content is not an SVG document");
  }
  return { safe: issues.length === 0, issues };
}

export const safeSvgInspector: SvgSafetyInspector = {
  inspect: inspectSvgSafety,
};

function numericSvgAttribute(
  text: string,
  attribute: "width" | "height",
): number | undefined {
  const match = text.match(
    new RegExp(
      `\\b${attribute}\\s*=\\s*["']([0-9]+(?:\\.[0-9]+)?)(?:px)?["']`,
      "i",
    ),
  );
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function svgViewport(data: Uint8Array): ImageDimensions {
  const text = Buffer.from(data).toString("utf8");
  const viewBox = text.match(
    /\bviewBox\s*=\s*["']\s*[-+\d.eE]+[\s,]+[-+\d.eE]+[\s,]+([+\d.eE-]+)[\s,]+([+\d.eE-]+)\s*["']/i,
  );
  const width =
    (numericSvgAttribute(text, "width") ?? Number(viewBox?.[1])) || 1200;
  const height =
    (numericSvgAttribute(text, "height") ?? Number(viewBox?.[2])) || 630;
  return {
    width: Math.max(1, Math.min(4096, Math.round(width))),
    height: Math.max(1, Math.min(4096, Math.round(height))),
  };
}

export function resolveProjectChromiumExecutable(): string | undefined {
  const candidates = [
    process.env.MPFORGE_CHROMIUM_EXECUTABLE,
    chromium.executablePath(),
    path.join(
      process.cwd(),
      ".cache",
      "playwright",
      "chromium-1234",
      "chrome-win64",
      "chrome.exe",
    ),
  ];
  return candidates.find((candidate): candidate is string =>
    Boolean(candidate && existsSync(candidate)),
  );
}

/** Rasterizes already-inspected SVG bytes without network access. */
export const projectLocalSvgConverter: SvgConverter = {
  async convert(data) {
    const safety = inspectSvgSafety(data);
    if (!safety.safe) {
      throw new MediaError(
        "UNSAFE_SVG",
        `SVG rejected: ${safety.issues.join("; ")}`,
      );
    }
    const executablePath = resolveProjectChromiumExecutable();
    if (!executablePath) {
      throw new MediaError(
        "SVG_CONVERTER_UNAVAILABLE",
        "Project-local Chromium is required for safe SVG rasterization.",
      );
    }
    const viewport = svgViewport(data);
    const browser = await chromium.launch({ executablePath, headless: true });
    try {
      const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
      await page.route(/^https?:\/\//, async (route) =>
        route.abort("blockedbyclient"),
      );
      const svg = Buffer.from(data).toString("utf8");
      await page.setContent(
        `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}svg{display:block}</style></head><body>${svg}</body></html>`,
        { waitUntil: "load" },
      );
      const locator = page.locator("svg").first();
      await locator.waitFor({ state: "visible" });
      const png = await locator.screenshot({
        type: "png",
        animations: "disabled",
        omitBackground: true,
      });
      await page.close();
      return { source: "converted", data: png, contentType: "image/png" };
    } catch (cause) {
      throw new MediaError(
        "SVG_CONVERSION_FAILED",
        "Safe SVG rasterization failed.",
        { cause },
      );
    } finally {
      await browser.close();
    }
  },
};

/** Conversion is intentionally an adapter; no unlicensed binary is bundled. */
export const passthroughSvgConverter: SvgConverter = {
  convert(data) {
    return { source: "converted", data, contentType: "image/svg+xml" };
  },
};

export interface CoverMetadata {
  title?: string;
  alt?: string;
  focalPoint?: { x: number; y: number };
  credit?: string;
}

export interface CoverPreviewInput {
  /** Preview bytes may be generated by a UI/renderer adapter. */
  data?: Uint8Array;
  width?: number;
  height?: number;
  mimeType?: ImageMimeType;
  path?: string;
}

export interface CoverInput {
  source: string;
  metadata?: CoverMetadata;
  preview?: CoverPreviewInput;
}

export interface StagedImage {
  source: string;
  contentHash: string;
  mimeType: ImageMimeType;
  sizeBytes: number;
  dimensions?: ImageDimensions;
  relativePath: string;
  absolutePath: string;
}

export interface MediaStageResult {
  articleDirectory: string;
  assetsDirectory: string;
  images: StagedImage[];
  replacements: Record<string, string>;
  cover?: {
    image: StagedImage;
    metadata?: CoverMetadata;
    preview?: CoverPreviewInput;
  };
}

export interface StageOptions extends ImagePolicy {
  transformer?: ImageTransformer;
  transformerOptions?: ImageTransformerOptions;
  svgInspector?: SvgSafetyInspector;
  svgConverter?: SvgConverter;
}

export interface NetworkImageImport {
  url: string;
  /** Required acknowledgement that the caller has permission to import this asset. */
  rightsConfirmed: true;
}

export interface NetworkImageFetcher {
  fetch(input: {
    url: string;
  }): Promise<{ data: Uint8Array; contentType?: string }>;
}

export interface UploadConfirmation {
  confirmed: true;
  accountAlias: string;
}

export interface UploadedImage {
  url: string;
  mediaId?: string;
}

export interface MediaUploader {
  upload(input: {
    filePath: string;
    relativePath: string;
    mimeType: ImageMimeType;
    contentHash: string;
    accountAlias: string;
  }): Promise<UploadedImage>;
  /** Called for already-uploaded items when a later upload fails. */
  rollback?(uploaded: UploadedImage): Promise<void>;
}

export interface UploadResult {
  uploads: UploadedImage[];
  replacements: Record<string, string>;
}

const defaultMimeTypes: ReadonlySet<ImageMimeType> = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/svg+xml",
  "image/webp",
]);

function normalizeArticleDirectory(articleDirectory: string): string {
  if (!articleDirectory || articleDirectory.includes("\0")) {
    throw new MediaError(
      "INVALID_ARTICLE_DIRECTORY",
      "Article directory is invalid.",
    );
  }
  return path.resolve(articleDirectory);
}

function ensureWithin(root: string, candidate: string, code: string): void {
  const relative = path.relative(root, candidate);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new MediaError(
      code,
      "Media reference must stay inside the article directory.",
    );
  }
}

function isWindowsAbsolute(reference: string): boolean {
  return (
    path.win32.isAbsolute(reference) ||
    /^[a-zA-Z]:[\\/]/.test(reference) ||
    /^\\\\/.test(reference)
  );
}

/** Resolve only local, relative references. Network URLs must use importNetworkImages explicitly. */
export async function resolveLocalImageReference(
  articleDirectory: string,
  reference: string,
): Promise<string> {
  const root = await realpath(
    normalizeArticleDirectory(articleDirectory),
  ).catch((cause) => {
    throw new MediaError(
      "ARTICLE_DIRECTORY_MISSING",
      "Article directory does not exist.",
      { cause },
    );
  });
  const rawReference = reference.trim();
  const withoutFragment = rawReference.split(/[?#]/, 1)[0];
  if (!withoutFragment || withoutFragment.includes("\0")) {
    throw new MediaError(
      "INVALID_MEDIA_REFERENCE",
      "Media reference is empty or invalid.",
    );
  }
  if (
    isWindowsAbsolute(withoutFragment) ||
    path.posix.isAbsolute(withoutFragment) ||
    path.isAbsolute(withoutFragment)
  ) {
    throw new MediaError(
      "PATH_TRAVERSAL",
      "Absolute media references are not allowed.",
    );
  }
  if (
    /^[a-z][a-z\d+.-]*:/i.test(withoutFragment) ||
    withoutFragment.startsWith("//")
  ) {
    throw new MediaError(
      "NETWORK_REFERENCE",
      "Network or protocol references require explicit import.",
    );
  }
  const normalizedReference = withoutFragment.replace(/[\\/]+/g, path.sep);
  const candidate = path.resolve(root, normalizedReference);
  ensureWithin(root, candidate, "PATH_TRAVERSAL");
  const resolved = await realpath(candidate).catch((cause) => {
    throw new MediaError(
      "MEDIA_FILE_MISSING",
      "Referenced media file does not exist.",
      { cause },
    );
  });
  ensureWithin(root, resolved, "PATH_TRAVERSAL");
  const metadata = await stat(resolved);
  if (!metadata.isFile()) {
    throw new MediaError(
      "MEDIA_NOT_FILE",
      "Referenced media path is not a regular file.",
    );
  }
  return resolved;
}

function detectMimeType(
  data: Uint8Array,
  contentType?: string,
): ImageMimeType | undefined {
  if (
    data.length >= 8 &&
    Buffer.from(data.subarray(0, 8)).equals(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    )
  )
    return "image/png";
  if (
    data.length >= 3 &&
    data[0] === 0xff &&
    data[1] === 0xd8 &&
    data[2] === 0xff
  )
    return "image/jpeg";
  if (
    data.length >= 6 &&
    (Buffer.from(data.subarray(0, 6)).toString("ascii") === "GIF87a" ||
      Buffer.from(data.subarray(0, 6)).toString("ascii") === "GIF89a")
  )
    return "image/gif";
  if (
    data.length >= 12 &&
    Buffer.from(data.subarray(0, 4)).toString("ascii") === "RIFF" &&
    Buffer.from(data.subarray(8, 12)).toString("ascii") === "WEBP"
  )
    return "image/webp";
  const normalizedContentType = contentType
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (
    normalizedContentType === "image/svg" ||
    normalizedContentType === "image/svg+xml"
  )
    return "image/svg+xml";
  if (
    /^\s*(?:<\?xml[^>]*>\s*)?<svg\b/i.test(Buffer.from(data).toString("utf8"))
  )
    return "image/svg+xml";
  if (
    normalizedContentType &&
    defaultMimeTypes.has(normalizedContentType as ImageMimeType)
  )
    return normalizedContentType as ImageMimeType;
  return undefined;
}

function readPngDimensions(data: Uint8Array): ImageDimensions | undefined {
  return data.length >= 24
    ? {
        width: Buffer.from(data).readUInt32BE(16),
        height: Buffer.from(data).readUInt32BE(20),
      }
    : undefined;
}

function readGifDimensions(data: Uint8Array): ImageDimensions | undefined {
  return data.length >= 10
    ? {
        width: Buffer.from(data).readUInt16LE(6),
        height: Buffer.from(data).readUInt16LE(8),
      }
    : undefined;
}

function readJpegDimensions(data: Uint8Array): ImageDimensions | undefined {
  const bytes = Buffer.from(data);
  let offset = 2;
  while (offset + 9 < bytes.length && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1];
    offset += 2;
    if (
      marker === 0xd8 ||
      marker === 0xd9 ||
      (marker >= 0xd0 && marker <= 0xd7)
    )
      continue;
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length)
      return undefined;
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSof && offset + 7 < bytes.length)
      return {
        width: bytes.readUInt16BE(offset + 5),
        height: bytes.readUInt16BE(offset + 3),
      };
    offset += segmentLength;
  }
  return undefined;
}

function readWebpDimensions(data: Uint8Array): ImageDimensions | undefined {
  const bytes = Buffer.from(data);
  const kind = bytes.toString("ascii", 12, 16);
  if (kind === "VP8X" && bytes.length >= 30) {
    return {
      width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
      height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16),
    };
  }
  return undefined;
}

function dimensionsFor(
  mimeType: ImageMimeType,
  data: Uint8Array,
): ImageDimensions | undefined {
  if (mimeType === "image/png") return readPngDimensions(data);
  if (mimeType === "image/gif") return readGifDimensions(data);
  if (mimeType === "image/jpeg") return readJpegDimensions(data);
  if (mimeType === "image/webp") return readWebpDimensions(data);
  return undefined;
}

function extensionFor(mimeType: ImageMimeType): string {
  return {
    "image/gif": ".gif",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/svg+xml": ".svg",
    "image/webp": ".webp",
  }[mimeType];
}

function validateImage(
  data: Uint8Array,
  source: string,
  contentType: string | undefined,
  policy: ImagePolicy,
  svgInspector: SvgSafetyInspector,
): { mimeType: ImageMimeType; dimensions?: ImageDimensions } {
  const maxBytes = policy.maxBytes ?? DEFAULT_MAX_BYTES;
  if (data.byteLength > maxBytes)
    throw new MediaError(
      "MEDIA_TOO_LARGE",
      `Media exceeds the ${maxBytes}-byte limit.`,
    );
  const mimeType = detectMimeType(data, contentType);
  if (!mimeType)
    throw new MediaError(
      "UNSUPPORTED_MEDIA",
      `Unsupported media format for ${source}.`,
    );
  const allowed = policy.allowedMimeTypes ?? defaultMimeTypes;
  if (!allowed.has(mimeType))
    throw new MediaError(
      "MEDIA_TYPE_BLOCKED",
      `Media format is not allowed for ${source}.`,
    );
  if (mimeType === "image/svg+xml") {
    const report = svgInspector.inspect(data);
    if (!report.safe)
      throw new MediaError(
        "UNSAFE_SVG",
        `SVG rejected: ${report.issues.join("; ")}`,
      );
  }
  const dimensions = dimensionsFor(mimeType, data);
  if (dimensions && (dimensions.width <= 0 || dimensions.height <= 0))
    throw new MediaError("INVALID_DIMENSIONS", "Media dimensions are invalid.");
  if (dimensions && dimensions.width > (policy.maxWidth ?? DEFAULT_MAX_WIDTH))
    throw new MediaError(
      "MEDIA_TOO_WIDE",
      "Media width exceeds the configured limit.",
    );
  if (
    dimensions &&
    dimensions.height > (policy.maxHeight ?? DEFAULT_MAX_HEIGHT)
  )
    throw new MediaError(
      "MEDIA_TOO_TALL",
      "Media height exceeds the configured limit.",
    );
  return { mimeType, dimensions };
}

async function stageSources(
  articleDirectory: string,
  sources: ImageSource[],
  options: StageOptions = {},
): Promise<MediaStageResult> {
  const root = await realpath(normalizeArticleDirectory(articleDirectory));
  const assetsPath = path.join(root, ASSETS_DIRECTORY);
  let assetsDirectory = assetsPath;
  let assetsCreated = false;
  const stagingDirectory = path.join(
    root,
    `.mpforge-media-staging-${randomBytes(8).toString("hex")}`,
  );
  const transformer = options.transformer ?? passthroughImageTransformer;
  const svgInspector = options.svgInspector ?? safeSvgInspector;
  const newlyCommitted: string[] = [];
  const staged: StagedImage[] = [];
  const replacements: Record<string, string> = {};
  try {
    try {
      assetsDirectory = await realpath(assetsPath);
      ensureWithin(root, assetsDirectory, "ASSETS_OUTSIDE_ARTICLE");
      if (!(await stat(assetsDirectory)).isDirectory())
        throw new MediaError(
          "ASSETS_NOT_DIRECTORY",
          "Article assets path is not a directory.",
        );
    } catch (error) {
      if (error instanceof MediaError) throw error;
      if (
        !(
          error instanceof Error &&
          "code" in error &&
          (error as NodeJS.ErrnoException).code === "ENOENT"
        )
      )
        throw error;
      await mkdir(assetsPath, { recursive: true });
      assetsCreated = true;
      assetsDirectory = await realpath(assetsPath);
      ensureWithin(root, assetsDirectory, "ASSETS_OUTSIDE_ARTICLE");
    }
    await mkdir(stagingDirectory, { recursive: true });
    for (const source of sources) {
      const initial = validateImage(
        source.data,
        source.source,
        source.contentType,
        options,
        svgInspector,
      );
      let transformed = source;
      if (initial.mimeType !== "image/svg+xml") {
        transformed = await transformer.transform(
          source.data,
          initial.mimeType,
          options.transformerOptions,
        );
      } else {
        transformed = await (
          options.svgConverter ?? projectLocalSvgConverter
        ).convert(source.data, options.transformerOptions);
      }
      const final = validateImage(
        transformed.data,
        source.source,
        transformed.contentType ?? initial.mimeType,
        options,
        svgInspector,
      );
      const bytes = Buffer.from(transformed.data);
      const hash = createHash("sha256").update(bytes).digest("hex");
      const fileName = `${hash}${extensionFor(final.mimeType)}`;
      const stagedPath = path.join(stagingDirectory, fileName);
      const relativePath = path.posix.join(ASSETS_DIRECTORY, fileName);
      const targetPath = path.join(assetsDirectory, fileName);
      if (!staged.some((item) => item.contentHash === hash)) {
        await writeFile(stagedPath, bytes, { flag: "wx" });
      }
      staged.push({
        source: source.source,
        contentHash: hash,
        mimeType: final.mimeType,
        sizeBytes: bytes.byteLength,
        dimensions: final.dimensions,
        relativePath,
        absolutePath: targetPath,
      });
      replacements[source.source] = relativePath;
    }
    await mkdir(assetsDirectory, { recursive: true });
    for (const item of staged) {
      if (newlyCommitted.some((candidate) => candidate === item.absolutePath))
        continue;
      let exists = false;
      try {
        const existing = await readFile(item.absolutePath);
        exists =
          createHash("sha256").update(existing).digest("hex") ===
          item.contentHash;
        if (!exists)
          throw new MediaError(
            "HASH_COLLISION",
            "Content-addressed media path contains different bytes.",
          );
      } catch (error) {
        if (
          !(
            error instanceof Error &&
            "code" in error &&
            (error as NodeJS.ErrnoException).code === "ENOENT"
          )
        )
          throw error;
      }
      if (!exists) {
        await rename(
          path.join(stagingDirectory, path.basename(item.absolutePath)),
          item.absolutePath,
        );
        newlyCommitted.push(item.absolutePath);
      }
    }
    const result: MediaStageResult = {
      articleDirectory: root,
      assetsDirectory,
      images: staged,
      replacements,
    };
    await rm(stagingDirectory, { recursive: true, force: true });
    return result;
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true });
    await Promise.all(
      newlyCommitted.map((filePath) => rm(filePath, { force: true })),
    );
    if (assetsCreated) await rm(assetsPath, { recursive: true, force: true });
    throw error;
  }
}

export async function stageLocalImages(
  articleDirectory: string,
  references: readonly string[],
  options?: StageOptions,
): Promise<MediaStageResult> {
  const sources: ImageSource[] = [];
  for (const reference of references) {
    const absolutePath = await resolveLocalImageReference(
      articleDirectory,
      reference,
    );
    sources.push({ source: reference, data: await readFile(absolutePath) });
  }
  return stageSources(articleDirectory, sources, options);
}

/** Explicit network import. There is no implicit network fetch in local staging. */
export async function importNetworkImages(
  articleDirectory: string,
  imports: readonly NetworkImageImport[],
  fetcher: NetworkImageFetcher,
  options?: StageOptions,
): Promise<MediaStageResult> {
  const sources: ImageSource[] = [];
  for (const item of imports) {
    if (item.rightsConfirmed !== true)
      throw new MediaError(
        "RIGHTS_UNCONFIRMED",
        "Network image rights must be confirmed before import.",
      );
    let parsed: URL;
    try {
      parsed = new URL(item.url);
    } catch (cause) {
      throw new MediaError(
        "INVALID_NETWORK_URL",
        "Network image URL is invalid.",
        { cause },
      );
    }
    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
      parsed.username ||
      parsed.password
    )
      throw new MediaError(
        "INVALID_NETWORK_URL",
        "Only credential-free HTTP(S) image URLs are allowed.",
      );
    const hostname = parsed.hostname
      .toLowerCase()
      .replace(/\.$/, "")
      .replace(/^\[|\]$/g, "");
    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname === "metadata.google.internal" ||
      hostname === "instance-data.ec2.internal" ||
      (isIP(hostname) === 4 &&
        /^(?:0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(
          hostname,
        )) ||
      (isIP(hostname) === 6 &&
        (hostname === "::" ||
          hostname === "::1" ||
          /^(?:fc|fd|fe[89ab])/i.test(hostname)))
    )
      throw new MediaError(
        "SSRF_BLOCKED",
        "Local, private, and metadata network targets are blocked.",
      );
    const downloaded = await fetcher.fetch({ url: parsed.toString() });
    sources.push({
      source: item.url,
      data: downloaded.data,
      contentType: downloaded.contentType,
    });
  }
  return stageSources(articleDirectory, sources, options);
}

export function withCover(
  stage: MediaStageResult,
  cover: CoverInput,
): MediaStageResult {
  const image = stage.images.find((item) => item.source === cover.source);
  if (!image)
    throw new MediaError(
      "COVER_NOT_STAGED",
      "Cover source must be part of the staged images.",
    );
  return {
    ...stage,
    cover: { image, metadata: cover.metadata, preview: cover.preview },
  };
}

/** Upload is an explicit, confirmed side effect and never logs credentials or secrets. */
export async function uploadStagedImages(
  stage: MediaStageResult,
  uploader: MediaUploader,
  confirmation: UploadConfirmation,
): Promise<UploadResult> {
  if (confirmation.confirmed !== true || !confirmation.accountAlias.trim())
    throw new MediaError(
      "UPLOAD_NOT_CONFIRMED",
      "Upload requires explicit confirmation and an account alias.",
    );
  const uploads: UploadedImage[] = [];
  const replacements: Record<string, string> = {};
  const uploadedByHash = new Map<string, UploadedImage>();
  try {
    for (const image of stage.images) {
      const existing = uploadedByHash.get(image.contentHash);
      if (existing) {
        replacements[image.source] = existing.url;
        continue;
      }
      const uploaded = await uploader.upload({
        filePath: image.absolutePath,
        relativePath: image.relativePath,
        mimeType: image.mimeType,
        contentHash: image.contentHash,
        accountAlias: confirmation.accountAlias,
      });
      if (!uploaded.url || !/^https?:\/\//i.test(uploaded.url))
        throw new MediaError(
          "INVALID_UPLOAD_RESULT",
          "Uploader returned an invalid URL.",
        );
      uploads.push(uploaded);
      uploadedByHash.set(image.contentHash, uploaded);
      replacements[image.source] = uploaded.url;
    }
    return { uploads, replacements };
  } catch (error) {
    if (uploader.rollback) {
      await Promise.allSettled(
        uploads.map((uploaded) => uploader.rollback!(uploaded)),
      );
    }
    throw error;
  }
}
