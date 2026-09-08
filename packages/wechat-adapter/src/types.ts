export type ProviderMode = "mock" | "real";
export type CoverMaterialType = "image" | "thumb";

export interface ProviderCapabilities {
  providerMode: ProviderMode;
  draftOnly: true;
  bodyImage: {
    mimeTypes: readonly ["image/jpeg", "image/png"];
    maxBytesExclusive: number;
    returnedField: "url";
  };
  coverMaterial: {
    materialTypes: readonly ["image", "thumb"];
    imageMimeTypes: readonly string[];
    imageMaxBytes: number;
    thumbMimeTypes: readonly ["image/jpeg"];
    thumbMaxBytes: number;
    returnedField: "media_id";
    materialTypeRequiresAccountDoctor: true;
  };
  article: {
    titleMaxCharacters: 32;
    authorMaxCharacters: 16;
    digestMaxCharacters: 120;
    contentMaxCharactersExclusive: 20_000;
    contentMaxBytesExclusive: 1_000_000;
    contentLimitDocumentationConflict: true;
    sourceUrlMaxBytesExclusive: 1_000;
  };
  draftList: { pageSizeMin: 1; pageSizeMax: 20; orderingGuaranteed: false };
  clientIdempotencySupported: false;
}

export interface ProviderConfiguration {
  accountAlias: string;
  appIdEnvironmentVariable?: string;
  appSecretEnvironmentVariable?: string;
  coverMaterialType?: CoverMaterialType;
}
export interface ConfigurationValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  providerMode: ProviderMode;
}
export interface ServerCredentials {
  appId: string;
  appSecret: string;
}
export type CredentialProvider = () => Promise<ServerCredentials | undefined>;
export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;
export interface AccessToken {
  accessToken: string;
  expiresInSeconds: number;
  obtainedAt: string;
}
export interface MediaInput {
  relativePath: string;
  contentHash: string;
  mimeType: string;
  filePath?: string;
  bytes?: Uint8Array;
  accessToken?: string;
}
export interface CoverMaterialInput extends MediaInput {
  materialType: CoverMaterialType;
}
export interface BodyImageUpload {
  url: string;
  mediaId?: string;
}
export interface CoverMaterialUpload {
  mediaId: string;
  url?: string;
  materialType: CoverMaterialType;
}

export interface DraftArticleInput {
  article_type?: "news" | "newspic";
  title: string;
  author?: string;
  digest?: string;
  content: string;
  content_source_url?: string;
  thumb_media_id?: string;
  need_open_comment?: 0 | 1;
  only_fans_can_comment?: 0 | 1;
  image_info?: { image_list: ReadonlyArray<{ image_media_id: string }> };
  cover_info?: {
    crop_percent_list: ReadonlyArray<{
      ratio: string;
      x1: string;
      y1: string;
      x2: string;
      y2: string;
    }>;
  };
}
export interface CreateDraftInput {
  accessToken?: string;
  articles: readonly DraftArticleInput[];
  idempotencyKey?: string;
  operationId?: string;
  planHash?: string;
}
export interface CreateDraftResult {
  mediaId: string;
}
export interface DraftDetail {
  mediaId: string;
  newsItem: DraftArticleInput[];
}
export interface GetDraftInput {
  accessToken?: string;
  mediaId: string;
}
export interface DraftListItem extends DraftDetail {
  updateTime?: number;
}
export interface ListDraftsInput {
  accessToken?: string;
  offset: number;
  count: number;
  noContent?: 0 | 1;
}
export interface DraftPage {
  totalCount: number;
  itemCount: number;
  items: DraftListItem[];
}
export interface FindPossibleDraftInput {
  accessToken?: string;
  title: string;
  digest?: string;
  contentHash?: string;
  updatedAfter?: number;
  updatedBefore?: number;
  maxPages?: number;
}
export interface DraftCandidate {
  mediaId: string;
  updateTime?: number;
  titleMatch: true;
  digestMatch: boolean | null;
  contentHashMatch: boolean | null;
}
export interface PossibleDraftResult {
  disposition: "NONE" | "ONE_CANDIDATE" | "AMBIGUOUS";
  candidates: DraftCandidate[];
  pagesExamined: number;
  orderingAssumed: false;
}

export interface WeChatDraftProvider {
  getCapabilities(): Promise<ProviderCapabilities>;
  validateConfiguration(
    configuration?: ProviderConfiguration,
  ): Promise<ConfigurationValidation>;
  obtainAccessToken(): Promise<AccessToken>;
  uploadBodyImage(input: MediaInput): Promise<BodyImageUpload>;
  uploadCoverMaterial(input: CoverMaterialInput): Promise<CoverMaterialUpload>;
  createDraft(input: CreateDraftInput): Promise<CreateDraftResult>;
  getDraft(input: GetDraftInput): Promise<DraftDetail>;
  listDrafts(input: ListDraftsInput): Promise<DraftPage>;
  findPossibleDraft(
    input: FindPossibleDraftInput,
  ): Promise<PossibleDraftResult>;
  sanitizeRequest<T>(input: T): T;
  sanitizeResponse<T>(input: T): T;
}

export type ProviderErrorCategory =
  | "CONFIGURATION"
  | "CREDENTIAL"
  | "INPUT"
  | "IDENTIFIER"
  | "PERMISSION"
  | "ACCOUNT_RESTRICTION"
  | "RATE_LIMIT"
  | "REMOTE_BUSY"
  | "REMOTE_FAILURE";

export class ProviderError extends Error {
  readonly name = "ProviderError";
  constructor(
    readonly code: number | string,
    readonly category: ProviderErrorCategory,
    readonly retryable: boolean,
    readonly uncertainSideEffect: boolean,
    safeMessage: string,
  ) {
    super(safeMessage);
  }
}
