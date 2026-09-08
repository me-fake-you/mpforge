import {
  assertPage,
  commonCapabilities,
  findCandidates,
  mediaBytes,
  normalizeDetail,
  normalizePage,
  providerError,
  requestJson,
  requireAccessToken,
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
  type CredentialProvider,
  type DraftDetail,
  type DraftPage,
  type FetchLike,
  type FindPossibleDraftInput,
  type GetDraftInput,
  type ListDraftsInput,
  type MediaInput,
  type PossibleDraftResult,
  type ProviderCapabilities,
  type ProviderConfiguration,
  type ServerCredentials,
  type WeChatDraftProvider,
} from "./types.js";

export interface RealDraftProviderOptions {
  credentialProvider: CredentialProvider;
  fetch?: FetchLike;
}

export class RealDraftProvider implements WeChatDraftProvider {
  readonly #credentialProvider: CredentialProvider;
  readonly #fetch: FetchLike;
  readonly #apiBaseUrl: string;
  readonly #trustedImageUrls = new Set<string>();

  constructor(options: RealDraftProviderOptions) {
    this.#credentialProvider = options.credentialProvider;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#apiBaseUrl = "https://api.weixin.qq.com";
  }

  async getCapabilities(): Promise<ProviderCapabilities> {
    return commonCapabilities("real");
  }

  async validateConfiguration(
    configuration?: ProviderConfiguration,
  ): Promise<ConfigurationValidation> {
    const errors: string[] = [];
    const warnings = [
      "The current official article-content documentation contains conflicting size text.",
      "The permanent cover material type must be verified by account doctor before live use.",
    ];
    if (configuration && !configuration.accountAlias.trim())
      errors.push("ACCOUNT_ALIAS_REQUIRED");
    let credentials: ServerCredentials | undefined;
    try {
      credentials = await this.#credentialProvider();
    } catch {
      errors.push("CREDENTIAL_PROVIDER_FAILED");
    }
    if (!credentials?.appId || !credentials.appSecret)
      errors.push("CREDENTIALS_MISSING");
    else if (!/^[A-Za-z0-9_-]{6,128}$/.test(credentials.appId))
      errors.push("APP_ID_FORMAT_INVALID");
    return {
      ok: errors.length === 0,
      errors,
      warnings,
      providerMode: "real",
    };
  }

  async obtainAccessToken(): Promise<AccessToken> {
    const credentials = await this.#credentials();
    const result = await requestJson<RemoteJson>(
      this.#fetch,
      `${this.#apiBaseUrl}/cgi-bin/stable_token`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          grant_type: "client_credential",
          appid: credentials.appId,
          secret: credentials.appSecret,
          force_refresh: false,
        }),
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
        "Token is missing from the response.",
      );
    return {
      accessToken: value,
      expiresInSeconds: Number(result.expires_in ?? 0),
      obtainedAt: new Date().toISOString(),
    };
  }

  async uploadBodyImage(input: MediaInput): Promise<BodyImageUpload> {
    const bytes = await mediaBytes(input);
    validateBodyMedia(input, bytes);
    const token = requireAccessToken(input.accessToken);
    const form = new FormData();
    form.append(
      "media",
      new Blob([bytes.slice().buffer as ArrayBuffer], { type: input.mimeType }),
      input.relativePath.split(/[\\/]/).pop() ?? "image",
    );
    const url = new URL(`${this.#apiBaseUrl}/cgi-bin/media/uploadimg`);
    url.searchParams.set("access_token", token);
    const result = await requestJson<RemoteJson>(
      this.#fetch,
      url,
      { method: "POST", body: form },
      true,
    );
    const returnedUrl = String(result.url ?? "");
    if (!returnedUrl)
      throw new ProviderError(
        "INVALID_REMOTE_RESPONSE",
        "REMOTE_FAILURE",
        false,
        true,
        "Body image URL is missing from the response.",
      );
    this.#trustedImageUrls.add(returnedUrl);
    return { url: returnedUrl };
  }

  async uploadCoverMaterial(
    input: CoverMaterialInput,
  ): Promise<CoverMaterialUpload> {
    const bytes = await mediaBytes(input);
    validateCoverMedia(input, bytes);
    const token = requireAccessToken(input.accessToken);
    const form = new FormData();
    form.append(
      "media",
      new Blob([bytes.slice().buffer as ArrayBuffer], { type: input.mimeType }),
      input.relativePath.split(/[\\/]/).pop() ?? "cover",
    );
    const url = new URL(`${this.#apiBaseUrl}/cgi-bin/material/add_material`);
    url.searchParams.set("access_token", token);
    url.searchParams.set("type", input.materialType);
    const result = await requestJson<RemoteJson>(
      this.#fetch,
      url,
      { method: "POST", body: form },
      true,
    );
    const mediaId = String(result.media_id ?? "");
    if (!mediaId)
      throw new ProviderError(
        "INVALID_REMOTE_RESPONSE",
        "REMOTE_FAILURE",
        false,
        true,
        "Cover media identifier is missing from the response.",
      );
    return {
      mediaId,
      url: result.url ? String(result.url) : undefined,
      materialType: input.materialType,
    };
  }

  async createDraft(input: CreateDraftInput): Promise<CreateDraftResult> {
    validateCreateInput(input, this.#trustedImageUrls);
    const token = requireAccessToken(input.accessToken);
    const url = new URL(`${this.#apiBaseUrl}/cgi-bin/draft/add`);
    url.searchParams.set("access_token", token);
    const result = await requestJson<RemoteJson>(
      this.#fetch,
      url,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ articles: input.articles }),
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
        "Draft identifier is missing from the response.",
      );
    return { mediaId };
  }

  async getDraft(input: GetDraftInput): Promise<DraftDetail> {
    if (!input.mediaId.trim()) throw providerError(41006, false, false);
    const token = requireAccessToken(input.accessToken);
    const url = new URL(`${this.#apiBaseUrl}/cgi-bin/draft/get`);
    url.searchParams.set("access_token", token);
    const result = await requestJson<RemoteJson>(
      this.#fetch,
      url,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ media_id: input.mediaId }),
      },
      false,
    );
    return normalizeDetail({ ...result, media_id: input.mediaId });
  }

  async listDrafts(input: ListDraftsInput): Promise<DraftPage> {
    assertPage(input);
    const token = requireAccessToken(input.accessToken);
    const url = new URL(`${this.#apiBaseUrl}/cgi-bin/draft/batchget`);
    url.searchParams.set("access_token", token);
    const result = await requestJson<RemoteJson>(
      this.#fetch,
      url,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          offset: input.offset,
          count: input.count,
          no_content: input.noContent ?? 0,
        }),
      },
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

  async #credentials(): Promise<ServerCredentials> {
    let credentials: ServerCredentials | undefined;
    try {
      credentials = await this.#credentialProvider();
    } catch {
      credentials = undefined;
    }
    if (!credentials?.appId || !credentials.appSecret)
      throw new ProviderError(
        "CREDENTIALS_MISSING",
        "CONFIGURATION",
        false,
        false,
        "Server-side credentials are unavailable.",
      );
    return credentials;
  }
}

export function createEnvironmentCredentialProvider(
  appIdVariable: string,
  appSecretVariable: string,
  environment: NodeJS.ProcessEnv = process.env,
): CredentialProvider {
  return async () => {
    const appId = environment[appIdVariable];
    const appSecret = environment[appSecretVariable];
    return appId && appSecret ? { appId, appSecret } : undefined;
  };
}
