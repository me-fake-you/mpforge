export const CONTENT_SCHEMA_VERSION = 1 as const;
export const CONTENT_SCHEMA_ID = "mpforge.article/v1" as const;
export const AUDIT_SCHEMA_ID = "mpforge.audit/v1" as const;

export const ARTICLE_STATUSES = [
  "idea",
  "draft",
  "reviewing",
  "reviewed",
  "approved",
  "sent_to_draft",
  "published",
  "failed",
] as const;

export type ArticleStatus = (typeof ARTICLE_STATUSES)[number];

export type FrontmatterValue =
  | string
  | number
  | boolean
  | null
  | FrontmatterValue[]
  | { [key: string]: FrontmatterValue };

/** The portable fields stored in content/<slug>/article.md. */
export interface ArticleFrontmatter {
  id: string;
  slug: string;
  title: string;
  summary: string;
  author: string;
  account: string;
  theme: string;
  status: ArticleStatus;
  cover: string | null;
  source_url: string | null;
  original: boolean;
  ai_assisted: boolean;
  ai_tasks: string[];
  human_reviewed: boolean;
  need_open_comment: boolean;
  only_fans_can_comment: boolean;
  created_at: string;
  updated_at: string;
  version: number;
  /** Optional for forward-compatible migrations; unknown keys are preserved. */
  schema_version?: number;
  [key: string]: FrontmatterValue | undefined;
}

export type ArticleFrontmatterPatch = Partial<ArticleFrontmatter> &
  Record<string, FrontmatterValue | undefined>;

export interface FrontmatterValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  value?: ArticleFrontmatter;
}

export interface ParsedArticleDocument {
  frontmatter: Partial<ArticleFrontmatter> &
    Record<string, FrontmatterValue | undefined>;
  body: string;
  hasFrontmatter: boolean;
  legacy: boolean;
  hasBom: boolean;
  lineEnding: "\n" | "\r\n";
  diagnostics: string[];
}

export interface ArticleMigrationResult {
  value: ArticleFrontmatter;
  fromVersion: number;
  toVersion: typeof CONTENT_SCHEMA_VERSION;
  changes: string[];
}

export interface RuntimeSchemaResult<T> {
  success: boolean;
  data?: T;
  errors: string[];
}

export interface ArticleDocument extends ParsedArticleDocument {
  slug: string;
}

export type ActorKind = "human" | "ai" | "automation" | "system";

export interface AuditActor {
  kind: ActorKind;
  id?: string;
}

export type AuditAction =
  | "article.created"
  | "article.saved"
  | "status.changed"
  | "review.recommended"
  | "publish.attempted"
  | "publish.completed"
  | "publish.failed";

export interface AuditEvent {
  schema: typeof AUDIT_SCHEMA_ID;
  id: string;
  timestamp: string;
  actor: AuditActor;
  action: AuditAction;
  from_status?: ArticleStatus;
  to_status?: ArticleStatus;
  reason?: string;
  article_hash?: string;
  details?: Record<string, FrontmatterValue>;
}

export interface AuditParseResult {
  events: AuditEvent[];
  errors: string[];
}

export interface AuditReplayResult {
  status: ArticleStatus;
  events: AuditEvent[];
  valid: boolean;
  errors: string[];
}

export interface TransitionContext {
  actor: AuditActor;
  /** Service-level confirmation evidence; content-store requires it for approval. */
  explicitHumanAction?: boolean;
  timestamp?: string;
  eventId?: string;
  reason?: string;
  articleHash?: string;
  details?: Record<string, FrontmatterValue>;
}

export type TransitionError =
  | "invalid_transition"
  | "ai_may_only_recommend"
  | "approval_requires_human"
  | "draft_submission_requires_approval"
  | "published_is_terminal_for_this_version";

export interface TransitionResult {
  ok: boolean;
  from: ArticleStatus;
  to: ArticleStatus;
  error?: TransitionError;
  auditEvent?: AuditEvent;
}

export interface StatusRecommendation {
  from: ArticleStatus;
  to: ArticleStatus;
  actor: AuditActor;
  auditEvent: AuditEvent;
}

/** Canonical records in content/<slug>/history/state-events.jsonl. */
export interface StateEvent {
  event_id: string;
  article_id: string;
  from_status: ArticleStatus;
  to_status: ArticleStatus;
  actor_type: ActorKind;
  actor_id: string;
  reason: string;
  created_at: string;
  source_commit: string;
}
