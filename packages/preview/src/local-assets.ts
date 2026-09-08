import { createHash } from "node:crypto";
import { realpath, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  HtmlPreviewStages,
  LocalPreviewAsset,
  LocalPreviewAssetIssue,
} from "./types.js";

const MAX_ASSET_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_ASSET_BYTES = 32 * 1024 * 1024;
const BLOCKED_IMAGE_URL = "data:,";

const UNSAFE_SVG_PATTERNS: readonly [RegExp, string][] = [
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
] as const;

export interface PreparedPreviewStages {
  stages: HtmlPreviewStages;
  assets: LocalPreviewAsset[];
  issues: LocalPreviewAssetIssue[];
}

interface ResolvedAsset {
  replacement: string;
  asset?: LocalPreviewAsset;
  issue?: LocalPreviewAssetIssue;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function decodeAttribute(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .trim();
}

function withoutQueryOrFragment(reference: string): string {
  const query = reference.indexOf("?");
  const fragment = reference.indexOf("#");
  const end = Math.min(
    query < 0 ? reference.length : query,
    fragment < 0 ? reference.length : fragment,
  );
  return reference.slice(0, end);
}

function sniffMime(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  const firstSix = Buffer.from(bytes.subarray(0, 6)).toString("ascii");
  if (firstSix === "GIF87a" || firstSix === "GIF89a") return "image/gif";
  if (
    bytes.length >= 12 &&
    Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" &&
    Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  const textPrefix = Buffer.from(
    bytes.subarray(0, Math.min(bytes.length, 4_096)),
  )
    .toString("utf8")
    .replace(/^\uFEFF/, "")
    .trimStart();
  if (/^(?:<\?xml\b[^>]*>\s*)?<svg\b/i.test(textPrefix)) return "image/svg+xml";
  return null;
}

export function inspectPreviewSvgSafety(bytes: Uint8Array): string[] {
  const text = Buffer.from(bytes).toString("utf8");
  const issues = UNSAFE_SVG_PATTERNS.filter(([pattern]) =>
    pattern.test(text),
  ).map(([, message]) => message);
  if (!/^\s*(?:<\?xml[^>]*>\s*)?<svg\b/i.test(text.replace(/^\uFEFF/, ""))) {
    issues.push("content is not an SVG document");
  }
  return issues;
}

async function localBaseDirectory(baseUrl?: string): Promise<string | null> {
  if (!baseUrl) return null;
  let candidate: string;
  if (/^file:/i.test(baseUrl)) {
    const url = new URL(baseUrl);
    if (url.protocol !== "file:")
      throw new TypeError("Preview baseUrl must be a local file directory.");
    candidate = fileURLToPath(url);
  } else {
    if (/^[a-z][a-z\d+.-]*:/i.test(baseUrl)) {
      throw new TypeError("Preview baseUrl must be a local file directory.");
    }
    candidate = path.resolve(baseUrl);
  }
  const information = await stat(candidate);
  if (!information.isDirectory())
    throw new TypeError("Preview baseUrl must resolve to a directory.");
  return realpath(candidate);
}

class LocalAssetResolver {
  readonly #root: string | null;
  readonly #cache = new Map<string, Promise<ResolvedAsset>>();
  #totalBytes = 0;

  constructor(root: string | null) {
    this.#root = root;
  }

  resolve(referenceValue: string): Promise<ResolvedAsset> {
    const reference = decodeAttribute(referenceValue);
    const cached = this.#cache.get(reference);
    if (cached) return cached;
    const pending = this.#resolve(reference);
    this.#cache.set(reference, pending);
    return pending;
  }

  async #resolve(reference: string): Promise<ResolvedAsset> {
    const issue = (
      code: LocalPreviewAssetIssue["code"],
      message: string,
    ): ResolvedAsset => ({
      replacement: BLOCKED_IMAGE_URL,
      issue: { original_reference: reference, code, message },
    });
    if (!reference)
      return issue("empty-reference", "Image reference is empty.");
    if (/^(?:data:|blob:|#)/i.test(reference))
      return { replacement: reference };
    if (/^(?:https?:)?\/\//i.test(reference)) {
      return issue(
        "network-blocked",
        "Network images are not loaded during preview generation.",
      );
    }
    if (/^(?:ftp|javascript):/i.test(reference)) {
      return issue(
        "unsupported-protocol",
        "Only article-local image references can be inlined.",
      );
    }
    if (!this.#root) {
      return issue(
        "base-url-missing",
        "A local baseUrl is required to resolve article-local images.",
      );
    }

    let candidate: string;
    try {
      if (/^file:/i.test(reference)) {
        candidate = fileURLToPath(new URL(reference));
      } else {
        const localReference = decodeURIComponent(
          withoutQueryOrFragment(reference),
        );
        if (
          localReference.includes("\0") ||
          path.isAbsolute(localReference) ||
          /^[a-z]:[\\/]/i.test(localReference) ||
          localReference.startsWith("\\\\")
        ) {
          return issue(
            "absolute-path-blocked",
            "Absolute image paths are not accepted in article HTML.",
          );
        }
        candidate = path.resolve(
          this.#root,
          localReference.replaceAll("/", path.sep),
        );
      }
    } catch {
      return issue(
        "invalid-reference",
        "Image reference is not a valid local path.",
      );
    }
    if (!isWithin(this.#root, candidate)) {
      return issue(
        "path-traversal",
        "Image reference escapes the article directory.",
      );
    }

    let resolved: string;
    let information;
    try {
      resolved = await realpath(candidate);
      if (!isWithin(this.#root, resolved)) {
        return issue(
          "symlink-escape",
          "Image symlink resolves outside the article directory.",
        );
      }
      information = await stat(resolved);
    } catch {
      return issue(
        "not-found",
        "Local image does not exist or cannot be read.",
      );
    }
    if (!information.isFile())
      return issue(
        "not-a-file",
        "Local image reference is not a regular file.",
      );
    if (information.size > MAX_ASSET_BYTES) {
      return issue(
        "asset-too-large",
        `Local preview image exceeds ${MAX_ASSET_BYTES} bytes.`,
      );
    }
    if (this.#totalBytes + information.size > MAX_TOTAL_ASSET_BYTES) {
      return issue(
        "asset-budget-exceeded",
        `Local preview images exceed the ${MAX_TOTAL_ASSET_BYTES}-byte total budget.`,
      );
    }

    const bytes = await readFile(resolved);
    const mimeType = sniffMime(bytes);
    if (!mimeType)
      return issue(
        "unsupported-image",
        "File bytes are not a supported PNG, JPEG, GIF, WebP, or SVG image.",
      );
    if (mimeType === "image/svg+xml") {
      const svgIssues = inspectPreviewSvgSafety(bytes);
      if (svgIssues.length > 0) {
        return issue("unsafe-svg", `SVG rejected: ${svgIssues.join("; ")}`);
      }
    }
    this.#totalBytes += bytes.byteLength;
    return {
      replacement: `data:${mimeType};base64,${bytes.toString("base64")}`,
      asset: {
        original_reference: reference,
        local_path: path
          .relative(this.#root, resolved)
          .split(path.sep)
          .join("/"),
        sha256: sha256(bytes),
        mime_type: mimeType,
        byte_length: bytes.byteLength,
      },
    };
  }
}

async function replaceAsync(
  value: string,
  pattern: RegExp,
  replacement: (match: RegExpExecArray) => Promise<string>,
): Promise<string> {
  const parts: string[] = [];
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0;
    parts.push(value.slice(cursor, index), await replacement(match));
    cursor = index + match[0].length;
  }
  parts.push(value.slice(cursor));
  return parts.join("");
}

async function replaceUrlAttribute(
  tag: string,
  resolver: LocalAssetResolver,
): Promise<string> {
  const tagName = /^<\s*([\w:-]+)/.exec(tag)?.[1]?.toLocaleLowerCase() ?? "";
  const allowed =
    tagName === "img" || tagName === "source" || tagName === "input"
      ? new Set(["src"])
      : tagName === "video"
        ? new Set(["poster"])
        : tagName === "image"
          ? new Set(["href", "xlink:href"])
          : new Set<string>();
  return replaceAsync(
    tag,
    /(\s([\w:-]+)\s*=\s*)(?:(["'])(.*?)\3|([^\s>]+))/gi,
    async (match) => {
      const name = (match[2] ?? "").toLocaleLowerCase();
      const quote = match[3] ?? '"';
      const value = match[4] ?? match[5] ?? "";
      if (name === "srcset" && (tagName === "img" || tagName === "source")) {
        if (/^\s*data:/i.test(value)) return match[0];
        const candidates = value.split(",");
        const replacements = await Promise.all(
          candidates.map(async (candidate) => {
            const [reference, ...descriptor] = candidate.trim().split(/\s+/);
            const resolved = await resolver.resolve(reference ?? "");
            return `${resolved.replacement}${descriptor.length ? ` ${descriptor.join(" ")}` : ""}`;
          }),
        );
        return `${match[1]}${quote}${replacements.join(", ")}${quote}`;
      }
      if (!allowed.has(name)) return match[0];
      const resolved = await resolver.resolve(value);
      return `${match[1]}${quote}${resolved.replacement}${quote}`;
    },
  );
}

async function inlineOneHtml(
  html: string,
  resolver: LocalAssetResolver,
): Promise<string> {
  const tagsReplaced = await replaceAsync(
    html,
    /<(?:img|source|video|image|input)\b[^>]*>/gi,
    async (match) => replaceUrlAttribute(match[0], resolver),
  );
  return replaceAsync(
    tagsReplaced,
    /url\(\s*(?:(["'])(.*?)\1|([^"')\s][^)]*))\s*\)/gi,
    async (match) => {
      const reference = match[2] ?? match[3] ?? "";
      const resolved = await resolver.resolve(reference.trim());
      return `url("${resolved.replacement}")`;
    },
  );
}

export async function preparePreviewStages(
  stages: HtmlPreviewStages,
  baseUrl?: string,
): Promise<PreparedPreviewStages> {
  const resolver = new LocalAssetResolver(await localBaseDirectory(baseUrl));
  const prepared: HtmlPreviewStages = {
    raw: await inlineOneHtml(stages.raw, resolver),
    safe: await inlineOneHtml(stages.safe, resolver),
    wechat: await inlineOneHtml(stages.wechat, resolver),
  };

  const references = new Set<string>();
  for (const html of Object.values(stages)) {
    for (const match of html.matchAll(
      /<(?:img|source|video|image|input)\b[^>]*\s(?:src|srcset|poster|href|xlink:href)\s*=\s*(?:["']([^"']*)["']|([^\s>]+))/gi,
    )) {
      const value = match[1] ?? match[2] ?? "";
      if (!/\s*,\s*/.test(value)) references.add(decodeAttribute(value));
    }
    for (const match of html.matchAll(
      /url\(\s*(?:["']([^"']*)["']|([^)]*))\s*\)/gi,
    )) {
      references.add(decodeAttribute(match[1] ?? match[2] ?? ""));
    }
  }
  const resolutions = await Promise.all(
    [...references].sort().map((reference) => resolver.resolve(reference)),
  );
  const assets = new Map<string, LocalPreviewAsset>();
  const issues = new Map<string, LocalPreviewAssetIssue>();
  for (const resolution of resolutions) {
    if (resolution.asset) assets.set(resolution.asset.sha256, resolution.asset);
    if (resolution.issue) {
      issues.set(
        `${resolution.issue.original_reference}\0${resolution.issue.code}`,
        resolution.issue,
      );
    }
  }
  return {
    stages: prepared,
    assets: [...assets.values()].sort((left, right) =>
      left.original_reference.localeCompare(right.original_reference),
    ),
    issues: [...issues.values()].sort(
      (left, right) =>
        left.original_reference.localeCompare(right.original_reference) ||
        left.code.localeCompare(right.code),
    ),
  };
}
