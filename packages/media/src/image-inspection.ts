import path from "node:path";
import { inspectSvgSafety, MediaError } from "./media.js";
import type { InspectedImage, MediaSecurityPolicy } from "./pipeline-types.js";

export const SECURE_DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
export const SECURE_DEFAULT_MAX_WIDTH = 10_000;
export const SECURE_DEFAULT_MAX_HEIGHT = 10_000;
export const SECURE_DEFAULT_MAX_PIXELS = 40_000_000;

const MIME_EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/webp": [".webp"],
  "image/gif": [".gif"],
  "image/svg+xml": [".svg"],
};

function isPng(bytes: Buffer): boolean {
  return (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  );
}

function isJpeg(bytes: Buffer): boolean {
  return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

function isGif(bytes: Buffer): boolean {
  const signature = bytes.toString("ascii", 0, 6);
  return signature === "GIF87a" || signature === "GIF89a";
}

function isWebp(bytes: Buffer): boolean {
  return (
    bytes.length >= 16 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  );
}

function isSvg(bytes: Buffer): boolean {
  if (bytes.includes(0)) return false;
  return /^\s*(?:<\?xml[^>]*>\s*)?<svg\b/i.test(bytes.toString("utf8"));
}

export function sniffImageMime(data: Uint8Array): string | undefined {
  const bytes = Buffer.from(data);
  if (isPng(bytes)) return "image/png";
  if (isJpeg(bytes)) return "image/jpeg";
  if (isGif(bytes)) return "image/gif";
  if (isWebp(bytes)) return "image/webp";
  if (isSvg(bytes)) return "image/svg+xml";
  return undefined;
}

function pngInfo(bytes: Buffer): {
  width: number;
  height: number;
  hasAlpha: boolean;
} {
  if (
    bytes.length < 33 ||
    bytes.readUInt32BE(8) !== 13 ||
    bytes.toString("ascii", 12, 16) !== "IHDR"
  ) {
    throw new MediaError("CORRUPT_IMAGE", "PNG is missing a valid IHDR chunk.");
  }
  let offset = 8;
  let sawIdat = false;
  let sawIend = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (!Number.isSafeInteger(end) || end > bytes.length) {
      throw new MediaError("CORRUPT_IMAGE", "PNG contains a truncated chunk.");
    }
    const kind = bytes.toString("ascii", offset + 4, offset + 8);
    if (kind === "IDAT") sawIdat = true;
    if (kind === "IEND") {
      if (length !== 0 || end !== bytes.length) {
        throw new MediaError(
          "CORRUPT_IMAGE",
          "PNG IEND is malformed or has trailing data.",
        );
      }
      sawIend = true;
      break;
    }
    offset = end;
  }
  if (!sawIdat || !sawIend) {
    throw new MediaError("CORRUPT_IMAGE", "PNG is missing IDAT or IEND.");
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const colorType = bytes[25];
  return { width, height, hasAlpha: colorType === 4 || colorType === 6 };
}

function gifInfo(bytes: Buffer): {
  width: number;
  height: number;
  animated: boolean;
  hasAlpha: boolean;
} {
  if (bytes.length < 14 || bytes[bytes.length - 1] !== 0x3b) {
    throw new MediaError("CORRUPT_IMAGE", "GIF is truncated or malformed.");
  }
  let frames = 0;
  let transparent = false;
  for (let index = 13; index < bytes.length; index += 1) {
    if (bytes[index] === 0x2c) frames += 1;
    if (
      bytes[index] === 0x21 &&
      bytes[index + 1] === 0xf9 &&
      (bytes[index + 3] & 0x01) !== 0
    ) {
      transparent = true;
    }
  }
  return {
    width: bytes.readUInt16LE(6),
    height: bytes.readUInt16LE(8),
    animated: frames > 1,
    hasAlpha: transparent,
  };
}

function jpegInfo(bytes: Buffer): {
  width: number;
  height: number;
  exifPresent: boolean;
  gpsMetadataPresent: boolean;
} {
  if (
    bytes.length < 4 ||
    bytes[bytes.length - 2] !== 0xff ||
    bytes[bytes.length - 1] !== 0xd9
  ) {
    throw new MediaError("CORRUPT_IMAGE", "JPEG is truncated or missing EOI.");
  }
  let offset = 2;
  let width = 0;
  let height = 0;
  let exifPresent = false;
  let gpsMetadataPresent = false;
  while (offset + 4 <= bytes.length - 2) {
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) {
      throw new MediaError(
        "CORRUPT_IMAGE",
        "JPEG contains an invalid segment.",
      );
    }
    const segmentStart = offset + 2;
    const segmentEnd = offset + length;
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSof && segmentStart + 5 <= segmentEnd) {
      height = bytes.readUInt16BE(segmentStart + 1);
      width = bytes.readUInt16BE(segmentStart + 3);
    }
    if (
      marker === 0xe1 &&
      bytes.toString(
        "ascii",
        segmentStart,
        Math.min(segmentStart + 6, segmentEnd),
      ) === "Exif\0\0"
    ) {
      exifPresent = true;
      const exif = bytes.subarray(segmentStart + 6, segmentEnd);
      gpsMetadataPresent = containsGpsIfd(exif);
    }
    offset += length;
  }
  if (!width || !height) {
    throw new MediaError("CORRUPT_IMAGE", "JPEG dimensions could not be read.");
  }
  return { width, height, exifPresent, gpsMetadataPresent };
}

function containsGpsIfd(tiff: Buffer): boolean {
  if (tiff.length < 8) return false;
  const little = tiff.toString("ascii", 0, 2) === "II";
  const big = tiff.toString("ascii", 0, 2) === "MM";
  if (!little && !big) return false;
  const read16 = (position: number) =>
    little ? tiff.readUInt16LE(position) : tiff.readUInt16BE(position);
  const read32 = (position: number) =>
    little ? tiff.readUInt32LE(position) : tiff.readUInt32BE(position);
  try {
    const ifdOffset = read32(4);
    if (ifdOffset + 2 > tiff.length) return false;
    const count = read16(ifdOffset);
    for (let index = 0; index < count; index += 1) {
      const entry = ifdOffset + 2 + index * 12;
      if (entry + 12 > tiff.length) return false;
      if (read16(entry) === 0x8825) return true;
    }
  } catch {
    return false;
  }
  return false;
}

function webpInfo(bytes: Buffer): {
  width: number;
  height: number;
  animated: boolean;
  hasAlpha: boolean;
  exifPresent: boolean;
} {
  const declaredLength = bytes.readUInt32LE(4) + 8;
  if (declaredLength !== bytes.length || bytes.length < 25) {
    throw new MediaError("CORRUPT_IMAGE", "WebP RIFF data is truncated.");
  }
  const kind = bytes.toString("ascii", 12, 16);
  if (kind === "VP8X") {
    if (bytes.length < 30)
      throw new MediaError("CORRUPT_IMAGE", "WebP VP8X header is truncated.");
    const flags = bytes[20];
    return {
      width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
      height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16),
      animated: (flags & 0x02) !== 0,
      hasAlpha: (flags & 0x10) !== 0,
      exifPresent: (flags & 0x08) !== 0 || bytes.includes(Buffer.from("EXIF")),
    };
  }
  if (kind === "VP8 ") {
    if (
      bytes.length < 30 ||
      bytes[23] !== 0x9d ||
      bytes[24] !== 0x01 ||
      bytes[25] !== 0x2a
    ) {
      throw new MediaError(
        "CORRUPT_IMAGE",
        "WebP VP8 frame header is invalid.",
      );
    }
    return {
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff,
      animated: false,
      hasAlpha: false,
      exifPresent: bytes.includes(Buffer.from("EXIF")),
    };
  }
  if (kind === "VP8L") {
    if (bytes.length < 25 || bytes[20] !== 0x2f) {
      throw new MediaError(
        "CORRUPT_IMAGE",
        "WebP VP8L frame header is invalid.",
      );
    }
    const bits = bytes.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >>> 14) & 0x3fff) + 1,
      animated: false,
      hasAlpha: true,
      exifPresent: bytes.includes(Buffer.from("EXIF")),
    };
  }
  throw new MediaError(
    "CORRUPT_IMAGE",
    "WebP image chunk is unsupported or malformed.",
  );
}

function svgInfo(bytes: Buffer): {
  width: number;
  height: number;
  hasAlpha: boolean;
} {
  const report = inspectSvgSafety(bytes);
  if (!report.safe) {
    throw new MediaError(
      "UNSAFE_SVG",
      `SVG rejected: ${report.issues.join("; ")}`,
    );
  }
  const text = bytes.toString("utf8");
  const numeric = (name: string) => {
    const match = text.match(
      new RegExp(
        `\\b${name}\\s*=\\s*["']([0-9]+(?:\\.[0-9]+)?)(?:px)?["']`,
        "i",
      ),
    );
    return match ? Number(match[1]) : 0;
  };
  const viewBox = text.match(
    /\bviewBox\s*=\s*["']\s*[-+\d.eE]+[\s,]+[-+\d.eE]+[\s,]+([+\d.eE-]+)[\s,]+([+\d.eE-]+)\s*["']/i,
  );
  const width = numeric("width") || Number(viewBox?.[1]);
  const height = numeric("height") || Number(viewBox?.[2]);
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new MediaError(
      "INVALID_DIMENSIONS",
      "SVG requires positive dimensions or viewBox.",
    );
  }
  return {
    width: Math.round(width),
    height: Math.round(height),
    hasAlpha: true,
  };
}

export interface InspectImageOptions extends MediaSecurityPolicy {
  fileName?: string;
  declaredContentType?: string;
  rejectExtensionMismatch?: boolean;
}

export function inspectImageBytes(
  data: Uint8Array,
  options: InspectImageOptions = {},
): InspectedImage {
  const bytes = Buffer.from(data);
  const maxBytes = options.maxBytes ?? SECURE_DEFAULT_MAX_BYTES;
  if (bytes.byteLength > maxBytes) {
    throw new MediaError(
      "MEDIA_TOO_LARGE",
      `Image exceeds the ${maxBytes}-byte limit.`,
    );
  }
  const mimeType = sniffImageMime(bytes);
  if (!mimeType) {
    throw new MediaError(
      "UNSUPPORTED_MEDIA",
      "File bytes are not a supported image format.",
    );
  }
  const declared = options.declaredContentType
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (
    declared &&
    declared !== mimeType &&
    !(declared === "image/jpg" && mimeType === "image/jpeg")
  ) {
    throw new MediaError(
      "MIME_MISMATCH",
      `Declared MIME ${declared} does not match ${mimeType}.`,
    );
  }
  let width = 0;
  let height = 0;
  let animated = false;
  let hasAlpha = false;
  let exifPresent = false;
  let gpsMetadataPresent = false;
  if (mimeType === "image/png") {
    ({ width, height, hasAlpha } = pngInfo(bytes));
    exifPresent = bytes.includes(Buffer.from("eXIf"));
    gpsMetadataPresent = exifPresent && bytes.includes(Buffer.from("GPS"));
  } else if (mimeType === "image/jpeg") {
    ({ width, height, exifPresent, gpsMetadataPresent } = jpegInfo(bytes));
  } else if (mimeType === "image/gif") {
    ({ width, height, animated, hasAlpha } = gifInfo(bytes));
  } else if (mimeType === "image/webp") {
    ({ width, height, animated, hasAlpha, exifPresent } = webpInfo(bytes));
    gpsMetadataPresent = exifPresent && bytes.includes(Buffer.from("GPS"));
  } else {
    ({ width, height, hasAlpha } = svgInfo(bytes));
  }
  const maxWidth = options.maxWidth ?? SECURE_DEFAULT_MAX_WIDTH;
  const maxHeight = options.maxHeight ?? SECURE_DEFAULT_MAX_HEIGHT;
  const maxPixels = options.maxPixels ?? SECURE_DEFAULT_MAX_PIXELS;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new MediaError("INVALID_DIMENSIONS", "Image dimensions are invalid.");
  }
  if (width > maxWidth)
    throw new MediaError("MEDIA_TOO_WIDE", "Image width exceeds policy.");
  if (height > maxHeight)
    throw new MediaError("MEDIA_TOO_TALL", "Image height exceeds policy.");
  if (width * height > maxPixels) {
    throw new MediaError(
      "IMAGE_BOMB",
      "Decoded pixel count exceeds the safety limit.",
    );
  }
  const extension = options.fileName
    ? path.extname(options.fileName).toLowerCase()
    : "";
  const accepted = MIME_EXTENSIONS[mimeType] ?? [];
  const extensionMatches = !extension || accepted.includes(extension);
  if (!extensionMatches && options.rejectExtensionMismatch !== false) {
    throw new MediaError(
      "MIME_EXTENSION_MISMATCH",
      `File extension ${extension} does not match ${mimeType}.`,
    );
  }
  const warnings: string[] = [];
  if (animated) warnings.push("ANIMATED_IMAGE");
  if (exifPresent) warnings.push("EXIF_PRESENT");
  if (gpsMetadataPresent) warnings.push("GPS_METADATA_PRESENT");
  return {
    mimeType,
    fileSize: bytes.byteLength,
    width,
    height,
    animated,
    hasAlpha,
    exifPresent,
    gpsMetadataPresent,
    extensionMatches,
    warnings,
  };
}

export function extensionForImageMime(mimeType: string): string {
  const extension = MIME_EXTENSIONS[mimeType]?.[0];
  if (!extension)
    throw new MediaError(
      "UNSUPPORTED_MEDIA",
      `Unsupported image MIME ${mimeType}.`,
    );
  return extension;
}
