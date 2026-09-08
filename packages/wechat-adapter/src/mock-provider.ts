import {
  assertPage,
  commonCapabilities,
  findCandidates,
  mediaBytes,
  normalizeDetail,
  normalizePage,
  providerError,
  requestJson,
  sanitizeUnknown,
  type RemoteJson,
  validateBodyMedia,
  validateCoverMedia,
  validateCreateInput,
} from "./internals.js";
import {
  ProviderError,
  type AccessToken,
  type BodyImageUpload,
  type ConfigurationValidation,
  type CoverMaterialInput,
  type CoverMaterialUpload,
  type CreateDraftInput,
  type CreateDraftResult,
  type DraftDetail,
  type DraftPage,
  type FetchLike,
  type FindPossibleDraftInput,
  type GetDraftInput,
  type ListDraftsInput,
  type MediaInput,
  type PossibleDraftResult,
  type ProviderCapabilities,
  type WeChatDraftProvider,
} from "./types.js";

export interface MockProviderOptions {
  baseUrl: string;
  accountAlias?: string;
  fetch?: FetchLike;
  faultMode?: () => string | undefined;
}

function loopbackBaseUrl(value: string): string {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (!["localhost", "127.0.0.1", "::1"].includes(host))
    throw new ProviderError(
      "MOCK_LOOPBACK_REQUIRED",
      "CONFIGURATION",
      false,
      false,
      "The mock provider only connects to a loopback server.",
    );
  return url.toString().replace(/\/$/, "");
}

export class MockProvider implements WeChatDraftProvider {
  readonly #baseUrl: string;
  readonly #accountAlias: string;
  readonly #fetch: FetchLike;
  readonly #faultMode?: () => string | undefined;
  readonly #trustedImageUrls = new Set<string>();

  constructor(options: MockProviderOptions) {
    this.#baseUrl = loopbackBaseUrl(options.baseUrl);
    this.#accountAlias = options.accountAlias ?? "mock";
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#faultMode = options.faultMode;
  }

  async getCapabilities(): Promise<ProviderCapabilities> {
    await this.#json(
      `${this.#baseUrl}/v1/capabilities`,
      { method: "GET", headers: this.#headers() },
      false,
    );
    return commonCapabilities("mock");
  }

  async validateConfiguration(): Promise<ConfigurationValidation> {
    return {
      ok: true,
      errors: [],
      warnings: [
        "Local mock behavior does not verify live account permissions.",
      ],
      providerMode: "mock",
    };
  }

  async obtainAccessToken(): Promise<AccessToken> {
    const result = await this.#json(
      `${this.#baseUrl}/v1/token`,
      {
        method: "POST",
        headers: this.#headers(true),
        body: JSON.stringify({ account_alias: this.#accountAlias }),
      },
      false,
    );
    const value = String(result.access_token ?? "");
    if (!value)
      throw new ProviderError(
        "INVALID_REMOTE_RESPONSE",
        "REMOTE_FAILURE",
        false,
        false,
        "Token is missing from the mock response.",
      );
    return {
      accessToken: value,
      expiresInSeconds: Number(result.expires_in ?? 7200),
      obtainedAt: new Date().toISOString(),
    };
  }

  async uploadBodyImage(input: MediaInput): Promise<BodyImageUpload> {
    const bytes = await mediaBytes(input);
    validateBodyMedia(input, bytes);
    const result = await this.#json(
      `${this.#baseUrl}/v1/body-images`,
      {
        method: "POST",
        headers: this.#headers(true),
        body: JSON.stringify({
          relative_path: input.relativePath,
          content_hash: input.contentHash,
          mime_type: input.mimeType,
          data_base64: Buffer.from(bytes).toString("base64"),
        }),
      },
      true,
    );
    const rawUrl = String(result.url ?? "");
    if (!rawUrl)
      throw new ProviderError(
        "INVALID_REMOTE_RESPONSE",
        "REMOTE_FAILURE",
        false,
        true,
        "Body image URL is missing from the mock response.",
      );
    const url = new URL(rawUrl, `${this.#baseUrl}/`).toString();
    this.#trustedImageUrls.add(url);
    return {
      url,
      mediaId: result.media_id ? String(result.media_id) : undefined,
    };
  }

  async uploadCoverMaterial(
    input: CoverMaterialInput,
  ): Promise<CoverMaterialUpload> {
    const bytes = await mediaBytes(input);
    validateCoverMedia(input, bytes);
    const result = await this.#json(
      `${this.#baseUrl}/v1/cover-materials`,
      {
        method: "POST",
        headers: this.#headers(true),
        body: JSON.stringify({
          relative_path: input.relativePath,
          content_hash: input.contentHash,
          mime_type: input.mimeType,
          material_type: input.materialType,
          data_base64: Buffer.from(bytes).toString("base64"),
        }),
      },
      true,
    );
    const mediaId = String(result.media_id ?? "");
    if (!mediaId)
      throw new ProviderError(
        "INVALID_REMOTE_RESPONSE",
        "REMOTE_FAILURE",
        false,
        true,
        "Cover media identifier is missing from the mock response.",
      );
    return {
      mediaId,
      url: result.url
        ? new URL(String(result.url), `${this.#baseUrl}/`).toString()
        : undefined,
      materialType: input.materialType,
    };
  }

  async createDraft(input: CreateDraftInput): Promise<CreateDraftResult> {
    validateCreateInput(input, this.#trustedImageUrls);
    const result = await this.#json(
      `${this.#baseUrl}/v1/drafts`,
      {
        method: "POST",
        headers: this.#headers(true),
        body: JSON.stringify({
          articles: input.articles,
          idempotency_key: input.idempotencyKey,
          operation_id: input.operationId,
          plan_hash: input.planHash,
        }),
      },
      true,
    );
    const mediaId = String(result.media_id ?? result.mediaId ?? "");
    if (!mediaId)
      throw new ProviderError(
        "INVALID_REMOTE_RESPONSE",
        "REMOTE_FAILURE",
        false,
        true,
        "Draft identifier is missing from the mock response.",
      );
    return { mediaId };
  }

  async getDraft(input: GetDraftInput): Promise<DraftDetail> {
    if (!input.mediaId.trim()) throw providerError(41006, false, false);
    const result = await this.#json(
      `${this.#baseUrl}/v1/drafts/${encodeURIComponent(input.mediaId)}`,
      { method: "GET", headers: this.#headers() },
      false,
    );
    return normalizeDetail(result);
  }

  async listDrafts(input: ListDraftsInput): Promise<DraftPage> {
    assertPage(input);
    const query = new URLSearchParams({
      offset: String(input.offset),
      count: String(input.count),
      no_content: String(input.noContent ?? 0),
    });
    const result = await this.#json(
      `${this.#baseUrl}/v1/drafts?${query}`,
      { method: "GET", headers: this.#headers() },
      false,
    );
    return normalizePage(result);
  }

  async findPossibleDraft(
    input: FindPossibleDraftInput,
  ): Promise<PossibleDraftResult> {
    return findCandidates(this, input);
  }

  sanitizeRequest<T>(input: T): T {
    return sanitizeUnknown(input);
  }

  sanitizeResponse<T>(input: T): T {
    return sanitizeUnknown(input);
  }

  #headers(json = false): Record<string, string> {
    const headers: Record<string, string> = {};
    if (json) headers["content-type"] = "application/json";
    const fault = this.#faultMode?.();
    if (fault) headers["x-mpforge-fault"] = fault;
    return headers;
  }

  async #json(
    url: string,
    init: RequestInit,
    uncertain: boolean,
  ): Promise<RemoteJson> {
    const result = await requestJson<RemoteJson>(
      this.#fetch,
      url,
      init,
      uncertain,
    );
    if (result.mock !== true)
      throw new ProviderError(
        "MOCK_MARKER_REQUIRED",
        "REMOTE_FAILURE",
        false,
        uncertain,
        "The local service did not identify itself as mock.",
      );
    return result;
  }
}
