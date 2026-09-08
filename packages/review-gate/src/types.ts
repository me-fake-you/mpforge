export const REVIEW_CHECKLIST_KEYS = [
  "content_read",
  "title_summary_confirmed",
  "facts_citations_checked",
  "image_sources_checked",
  "image_rights_checked",
  "mobile_preview_checked",
  "dark_mode_checked",
  "account_confirmed",
  "no_sensitive_information",
  "no_unfinished_placeholders",
] as const;

export type ReviewChecklistKey = (typeof REVIEW_CHECKLIST_KEYS)[number];
export type ReviewChecklist = Record<ReviewChecklistKey, boolean>;

export type ReviewStatus =
  | "idea"
  | "draft"
  | "reviewing"
  | "reviewed"
  | "approved";

export type ActorType =
  | "human"
  | "agent"
  | "skill"
  | "mcp"
  | "ci"
  | "automation"
  | "github_action"
  | string;

export interface ReviewActor {
  actorType: ActorType;
  actorId: string;
  /** Must be supplied by an interactive human approval/revocation action. */
  explicitHumanAction?: boolean;
}

export type AssetRightsStatus = "approved" | "pending" | "blocked" | "unknown";

export interface AssetReviewEvidence {
  assetId: string;
  rightsStatus: AssetRightsStatus;
}

export interface BuildArtifactPresence {
  rawHtml: boolean;
  safeHtml: boolean;
  wechatHtml: boolean;
  lintReport: boolean;
  assetsManifest: boolean;
  previewReport: boolean;
}

/**
 * A caller-created, immutable snapshot of every value to which an approval is
 * bound. Keeping this type free of Node APIs lets Web and CLI share identical
 * eligibility decisions.
 */
export interface ReviewEvidence {
  articleId: string;
  status: ReviewStatus;
  sourceHash: string;
  renderedHtmlHash: string;
  wechatHtmlHash: string;
  lintReportHash: string;
  assetsManifestHash: string;
  themeHash: string;
  rendererVersion: string;
  linterVersion: string;
  rulesetVersion: string;
  buildSettingsHash: string;
  publishSettingsHash: string;
  lintErrorCount: number;
  assets: AssetReviewEvidence[];
  artifacts: BuildArtifactPresence;
  buildSourceHash: string;
  lintSourceHash: string;
  lintRenderedHtmlHash: string;
  previewSourceHash: string;
  previewRenderedHtmlHash: string;
  previewWechatHtmlHash: string;
}

export type ApprovalBlockerCode =
  | "STATUS_NOT_REVIEWED"
  | "LINT_ERRORS"
  | "ASSET_RIGHTS_NOT_APPROVED"
  | "BUILD_ARTIFACT_MISSING"
  | "HASH_MISSING"
  | "BUILD_SOURCE_MISMATCH"
  | "LINT_SOURCE_MISMATCH"
  | "LINT_RENDER_MISMATCH"
  | "PREVIEW_SOURCE_MISMATCH"
  | "PREVIEW_RENDER_MISMATCH"
  | "PREVIEW_WECHAT_MISMATCH"
  | "CHECKLIST_INCOMPLETE"
  | "ACTOR_NOT_HUMAN"
  | "HUMAN_ACTION_NOT_EXPLICIT"
  | "SOURCE_HASH_NOT_CONFIRMED"
  | "REVIEWER_ID_MISSING"
  | "SOURCE_COMMIT_MISSING";

export interface ApprovalBlocker {
  code: ApprovalBlockerCode;
  message: string;
  details?: Record<string, unknown>;
}

export interface ApprovalEligibility {
  eligible: boolean;
  blockers: ApprovalBlocker[];
}

export interface ApprovalRequest {
  evidence: ReviewEvidence;
  checklist: ReviewChecklist;
  actor: ReviewActor;
  confirmedSourceHash: string;
  warningsAcknowledged: string[];
  sourceCommit: string;
}

export interface ApprovalRecord {
  approval_id: string;
  article_id: string;
  reviewer_id: string;
  reviewer_type: "human";
  approved_at: string;
  source_hash: string;
  rendered_html_hash: string;
  wechat_html_hash: string;
  lint_report_hash: string;
  assets_manifest_hash: string;
  theme_hash: string;
  renderer_version: string;
  linter_version: string;
  ruleset_version: string;
  build_settings_hash: string;
  publish_settings_hash: string;
  checklist: ReviewChecklist;
  warnings_acknowledged: string[];
  source_commit: string;
  result: "approved";
  previous_record_hash: string | null;
  record_hash: string;
}

export type ApprovalInvalidationReason =
  | "source_changed"
  | "rendered_html_changed"
  | "wechat_html_changed"
  | "lint_report_changed"
  | "assets_manifest_changed"
  | "theme_changed"
  | "renderer_version_changed"
  | "linter_version_changed"
  | "ruleset_version_changed"
  | "build_settings_changed"
  | "publish_settings_changed"
  | "build_source_mismatch"
  | "lint_errors_introduced"
  | "asset_rights_changed"
  | "build_artifact_missing"
  | "preview_stale"
  | "status_changed"
  | "approval_revoked";

export interface ApprovalValidity {
  valid: boolean;
  reasons: ApprovalInvalidationReason[];
  targetStatus: "reviewed" | "draft";
}

export interface ApprovalInvalidationRecord {
  invalidation_id: string;
  previous_approval_id: string;
  invalidated_at: string;
  reason: ApprovalInvalidationReason;
  reasons: ApprovalInvalidationReason[];
  previous_source_hash: string;
  current_source_hash: string;
  previous_build_hash: string;
  current_build_hash: string;
  actor: {
    actor_type: ActorType;
    actor_id: string;
  };
  target_status: "reviewed" | "draft";
  previous_record_hash: string | null;
  record_hash: string;
}

export interface ChainVerification {
  valid: boolean;
  errors: string[];
}

export interface ReviewTransitionResult {
  ok: boolean;
  from: ReviewStatus;
  to?: "reviewing" | "reviewed";
  error?: "INVALID_REVIEW_TRANSITION" | "ACTOR_ID_MISSING";
}
