import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  ProviderError,
  type CreateDraftInput,
  type DraftArticleInput,
  type DraftDetail,
  type DraftPage,
  type FetchLike,
  type FindPossibleDraftInput,
  type ListDraftsInput,
  type MediaInput,
  type CoverMaterialInput,
  type PossibleDraftResult,
  type ProviderCapabilities,
  type ProviderErrorCategory,
  type ProviderMode,
  type WeChatDraftProvider,
} from "./types.js";

export const CAPABILITIES: Omit<ProviderCapabilities, "providerMode"> = {
  draftOnly: true,
  bodyImage: {
    mimeTypes: ["image/jpeg", "image/png"],
    maxBytesExclusive: 1_000_000,
    returnedField: "url",
  },
  coverMaterial: {
    materialTypes: ["image", "thumb"],
    imageMimeTypes: ["image/bmp", "image/png", "image/jpeg", "image/gif"],
    imageMaxBytes: 10_000_000,
    thumbMimeTypes: ["image/jpeg"],
    thumbMaxBytes: 64_000,
    returnedField: "media_id",
    materialTypeRequiresAccountDoctor: true,
  },
  article: {
    titleMaxCharacters: 32,
    authorMaxCharacters: 16,
    digestMaxCharacters: 120,
    contentMaxCharactersExclusive: 20_000,
    contentMaxBytesExclusive: 1_000_000,
    contentLimitDocumentationConflict: true,
    sourceUrlMaxBytesExclusive: 1_000,
  },
  draftList: { pageSizeMin: 1, pageSizeMax: 20, orderingGuaranteed: false },
  clientIdempotencySupported: false,
};

const SECRET_KEY =
  /(?:secret|access[_-]?token|authorization|cookie|password|private[_-]?key)/i;
const REDACTED = "[REDACTED]";

export function sanitizeUnknown<T>(input: T, seen = new WeakSet<object>()): T {
  if (input === null || input === undefined) return input;
  if (typeof input === "string") {
    try {
      const url = new URL(input);
      for (const key of [...url.searchParams.keys()]) {
        if (SECRET_KEY.test(key)) url.searchParams.set(key, REDACTED);
      }
      return url.toString() as T;
    } catch {
      return input;
    }
  }
  if (typeof input !== "object") return input;
  if (seen.has(input)) return REDACTED as T;
  seen.add(input);
  if (Array.isArray(input))
    return input.map((item) => sanitizeUnknown(item, seen)) as T;
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input))
    output[key] = SECRET_KEY.test(key)
      ? REDACTED
      : sanitizeUnknown(value, seen);
  return output as T;
}

export async function mediaBytes(input: MediaInput): Promise<Uint8Array> {
  if (input.bytes) return input.bytes;
  if (input.filePath) return readFile(input.filePath);
  throw new ProviderError(
    "MEDIA_BYTES_REQUIRED",
    "INPUT",
    false,
    false,
    "Media bytes or a server-side file path are required.",
  );
}

function validateMediaIdentity(input: MediaInput): void {
  if (!input.relativePath.trim() || !input.contentHash.trim()) {
    throw new ProviderError(
      "MEDIA_IDENTITY_REQUIRED",
      "INPUT",
      false,
      false,
      "Media provenance fields are required.",
    );
  }
}

export function validateBodyMedia(input: MediaInput, bytes: Uint8Array): void {
  validateMediaIdentity(input);
  if (!CAPABILITIES.bodyImage.mimeTypes.includes(input.mimeType as never))
    throw providerError(40005, false, false);
  if (bytes.byteLength >= CAPABILITIES.bodyImage.maxBytesExclusive)
    throw providerError(40009, false, false);
}

export function validateCoverMedia(
  input: CoverMaterialInput,
  bytes: Uint8Array,
): void {
  validateMediaIdentity(input);
  if (input.materialType === "thumb") {
    if (
      !CAPABILITIES.coverMaterial.thumbMimeTypes.includes(
        input.mimeType as never,
      )
    )
      throw providerError(40005, false, false);
    if (bytes.byteLength > CAPABILITIES.coverMaterial.thumbMaxBytes)
      throw providerError(45001, false, false);
    return;
  }
  if (!CAPABILITIES.coverMaterial.imageMimeTypes.includes(input.mimeType))
    throw providerError(40005, false, false);
  if (bytes.byteLength > CAPABILITIES.coverMaterial.imageMaxBytes)
    throw providerError(45001, false, false);
}

function validateArticle(
  article: DraftArticleInput,
  trustedImageUrls: Set<string>,
): void {
  const charCount = (value: string) => [...value].length;
  const byteCount = (value: string) => Buffer.byteLength(value, "utf8");
  if (!article.title.trim() || charCount(article.title) > 32)
    throw providerError(45003, false, false);
  if (article.author && charCount(article.author) > 16)
    throw providerError(45003, false, false);
  if (article.digest && charCount(article.digest) > 120)
    throw providerError(45002, false, false);
  if (
    !article.content.trim() ||
    charCount(article.content) >= 20_000 ||
    byteCount(article.content) >= 1_000_000
  )
    throw providerError(45002, false, false);
  if (
    article.content_source_url &&
    byteCount(article.content_source_url) >= 1_000
  )
    throw providerError(45005, false, false);
  if (
    /<script\b/i.test(article.content) ||
    /\son\w+\s*=/i.test(article.content)
  )
    throw new ProviderError(
      "UNSAFE_HTML",
      "INPUT",
      false,
      false,
      "Executable HTML is not accepted.",
    );
  const imageSource = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
  for (const match of article.content.matchAll(imageSource)) {
    if (!trustedImageUrls.has(match[1]))
      throw new ProviderError(
        "UNTRUSTED_BODY_IMAGE_URL",
        "INPUT",
        false,
        false,
        "Every body image must use a URL returned by uploadBodyImage.",
      );
  }
  const kind = article.article_type ?? "news";
  if (kind === "news" && !article.thumb_media_id?.trim())
    throw new ProviderError(
      "COVER_MEDIA_ID_REQUIRED",
      "INPUT",
      false,
      false,
      "A permanent cover media identifier is required for a news article.",
    );
  if (
    kind === "newspic" &&
    (!article.image_info ||
      article.image_info.image_list.length < 1 ||
      article.image_info.image_list.length > 20)
  )
    throw new ProviderError(
      "IMAGE_INFO_INVALID",
      "INPUT",
      false,
      false,
      "A picture article requires between 1 and 20 permanent image identifiers.",
    );
}

export function validateCreateInput(
  input: CreateDraftInput,
  trustedImageUrls: Set<string>,
): void {
  if (input.articles.length === 0) throw providerError(44003, false, false);
  for (const article of input.articles)
    validateArticle(article, trustedImageUrls);
}

function classify(code: number | string): {
  category: ProviderErrorCategory;
  retryable: boolean;
} {
  const numeric = Number(code);
  if (numeric === -1) return { category: "REMOTE_BUSY", retryable: true };
  if ([40001, 40014, 41001, 42001].includes(numeric))
    return { category: "CREDENTIAL", retryable: false };
  if ([40002, 40013, 40125, 40164, 40243, 41004].includes(numeric))
    return { category: "CONFIGURATION", retryable: false };
  if (
    [
      40005, 40009, 41005, 43002, 44002, 44003, 45001, 45002, 45003, 45005,
      45008, 53405,
    ].includes(numeric)
  )
    return { category: "INPUT", retryable: false };
  if ([40007, 41006].includes(numeric))
    return { category: "IDENTIFIER", retryable: false };
  if (numeric === 48001) return { category: "PERMISSION", retryable: false };
  if ([48004, 50002, 53404, 53406, 89503, 89506, 89507].includes(numeric))
    return { category: "ACCOUNT_RESTRICTION", retryable: false };
  if ([45009, 45011].includes(numeric))
    return { category: "RATE_LIMIT", retryable: true };
  return { category: "REMOTE_FAILURE", retryable: false };
}

export function providerError(
  code: number | string,
  uncertainSideEffect: boolean,
  useRemoteMessage: boolean,
  remoteMessage?: string,
): ProviderError {
  const details = classify(code);
  const suffix = useRemoteMessage && remoteMessage ? ` ${remoteMessage}` : "";
  return new ProviderError(
    code,
    details.category,
    uncertainSideEffect ? false : details.retryable,
    uncertainSideEffect,
    `WeChat API request failed (${String(code)}).${suffix}`,
  );
}

export type RemoteJson = Record<string, unknown> & {
  errcode?: number;
  errmsg?: string;
  error?: string;
};

function safeRemoteMessage(result: RemoteJson): string | undefined {
  const candidate = result.errmsg ?? result.error;
  if (!candidate) return undefined;
  return candidate
    .replace(
      /(?:access[_-]?token|secret|authorization|cookie)\s*[=:]\s*[^\s,;]+/gi,
      (match) => `${match.split(/[=:]/, 1)[0]}=[REDACTED]`,
    )
    .slice(0, 240);
}

export async function requestJson<T extends RemoteJson>(
  fetcher: FetchLike,
  input: string | URL,
  init: RequestInit,
  uncertainOnTransportFailure: boolean,
): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(input, init);
  } catch {
    throw new ProviderError(
      "UNKNOWN_REMOTE_RESPONSE",
      "REMOTE_FAILURE",
      false,
      uncertainOnTransportFailure,
      "The remote response was not received; no automatic retry is safe.",
    );
  }
  let result: T;
  try {
    result = (await response.json()) as T;
  } catch {
    throw new ProviderError(
      "INVALID_REMOTE_RESPONSE",
      "REMOTE_FAILURE",
      false,
      uncertainOnTransportFailure,
      "The remote response was not valid JSON.",
    );
  }
  if (
    !response.ok ||
    (typeof result.errcode === "number" && result.errcode !== 0)
  ) {
    const code = result.errcode ?? `HTTP_${response.status}`;
    throw providerError(
      code,
      uncertainOnTransportFailure,
      true,
      safeRemoteMessage(result),
    );
  }
  return result;
}

export function requireAccessToken(value: string | undefined): string {
  if (!value?.trim()) throw providerError(41001, false, false);
  return value;
}

export function normalizeDetail(result: RemoteJson): DraftDetail {
  const mediaId = String(result.media_id ?? result.mediaId ?? "");
  const newsItem = (result.news_item ??
    result.newsItem ??
    []) as DraftArticleInput[];
  if (!mediaId)
    throw new ProviderError(
      "INVALID_REMOTE_RESPONSE",
      "REMOTE_FAILURE",
      false,
      false,
      "Draft identifier is missing from the response.",
    );
  return { mediaId, newsItem };
}

export function normalizePage(result: RemoteJson): DraftPage {
  const rawItems = (result.item ?? result.items ?? []) as Array<
    Record<string, unknown>
  >;
  const items = rawItems.map((item) => {
    const content = (item.content ?? {}) as Record<string, unknown>;
    const rawTime = item.update_time ?? item.updateTime;
    return {
      mediaId: String(item.media_id ?? item.mediaId ?? ""),
      newsItem: (content.news_item ??
        item.news_item ??
        item.newsItem ??
        []) as DraftArticleInput[],
      updateTime: typeof rawTime === "number" ? rawTime : undefined,
    };
  });
  return {
    totalCount: Number(result.total_count ?? result.totalCount ?? items.length),
    itemCount: Number(result.item_count ?? result.itemCount ?? items.length),
    items,
  };
}

export function assertPage(input: ListDraftsInput): void {
  if (!Number.isInteger(input.offset) || input.offset < 0)
    throw new ProviderError(
      "OFFSET_INVALID",
      "INPUT",
      false,
      false,
      "Draft offset must be a non-negative integer.",
    );
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > 20)
    throw new ProviderError(
      "COUNT_INVALID",
      "INPUT",
      false,
      false,
      "Draft page size must be from 1 through 20.",
    );
}

export async function findCandidates(
  provider: Pick<WeChatDraftProvider, "listDrafts">,
  input: FindPossibleDraftInput,
): Promise<PossibleDraftResult> {
  const maxPages = Math.max(1, Math.min(input.maxPages ?? 5, 50));
  const candidates: PossibleDraftResult["candidates"] = [];
  let pagesExamined = 0;
  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const page = await provider.listDrafts({
      accessToken: input.accessToken,
      offset: pageIndex * 20,
      count: 20,
      noContent: 0,
    });
    pagesExamined += 1;
    for (const item of page.items) {
      if (
        input.updatedAfter !== undefined &&
        (item.updateTime ?? -Infinity) < input.updatedAfter
      )
        continue;
      if (
        input.updatedBefore !== undefined &&
        (item.updateTime ?? Infinity) > input.updatedBefore
      )
        continue;
      for (const article of item.newsItem) {
        if (article.title !== input.title) continue;
        const digestMatch =
          input.digest === undefined ? null : article.digest === input.digest;
        const contentHashMatch =
          input.contentHash === undefined
            ? null
            : createHash("sha256")
                .update(article.content, "utf8")
                .digest("hex") === input.contentHash;
        if (digestMatch === false || contentHashMatch === false) continue;
        candidates.push({
          mediaId: item.mediaId,
          updateTime: item.updateTime,
          titleMatch: true,
          digestMatch,
          contentHashMatch,
        });
      }
    }
    if ((pageIndex + 1) * 20 >= page.totalCount || page.itemCount === 0) break;
  }
  return {
    disposition:
      candidates.length === 0
        ? "NONE"
        : candidates.length === 1
          ? "ONE_CANDIDATE"
          : "AMBIGUOUS",
    candidates,
    pagesExamined,
    orderingAssumed: false,
  };
}

export function commonCapabilities(mode: ProviderMode): ProviderCapabilities {
  return { providerMode: mode, ...CAPABILITIES };
}
