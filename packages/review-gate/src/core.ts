import { sha256 } from "./sha256.js";
import {
  REVIEW_CHECKLIST_KEYS,
  type ActorType,
  type ApprovalBlocker,
  type ApprovalEligibility,
  type ApprovalInvalidationReason,
  type ApprovalInvalidationRecord,
  type ApprovalRecord,
  type ApprovalRequest,
  type ApprovalValidity,
  type ChainVerification,
  type ReviewActor,
  type ReviewChecklist,
  type ReviewEvidence,
  type ReviewStatus,
  type ReviewTransitionResult,
} from "./types.js";

export class ReviewGateError extends Error {
  constructor(
    readonly code:
      | "APPROVAL_BLOCKED"
      | "APPROVAL_CHAIN_INVALID"
      | "APPROVAL_NOT_STALE"
      | "REVOCATION_REQUIRES_HUMAN",
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ReviewGateError";
  }
}

export const EMPTY_REVIEW_CHECKLIST: Readonly<ReviewChecklist> = Object.freeze(
  Object.fromEntries(
    REVIEW_CHECKLIST_KEYS.map((key) => [key, false]),
  ) as unknown as ReviewChecklist,
);

export function isReviewChecklistComplete(checklist: ReviewChecklist): boolean {
  return REVIEW_CHECKLIST_KEYS.every((key) => checklist[key] === true);
}

/** Stable JSON is part of the on-disk audit format; changing it is a schema change. */
export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .filter((key) => object[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
    .join(",")}}`;
}

function evidenceBlockers(evidence: ReviewEvidence): ApprovalBlocker[] {
  const blockers: ApprovalBlocker[] = [];
  const requiredHashes = {
    sourceHash: evidence.sourceHash,
    renderedHtmlHash: evidence.renderedHtmlHash,
    wechatHtmlHash: evidence.wechatHtmlHash,
    lintReportHash: evidence.lintReportHash,
    assetsManifestHash: evidence.assetsManifestHash,
    themeHash: evidence.themeHash,
    buildSettingsHash: evidence.buildSettingsHash,
    publishSettingsHash: evidence.publishSettingsHash,
  };
  const missingHashes = Object.entries(requiredHashes)
    .filter(([, value]) => !value.trim())
    .map(([key]) => key);
  if (missingHashes.length)
    blockers.push({
      code: "HASH_MISSING",
      message: `Approval evidence is missing hashes: ${missingHashes.join(", ")}`,
      details: { fields: missingHashes },
    });
  if (!Number.isInteger(evidence.lintErrorCount) || evidence.lintErrorCount > 0)
    blockers.push({
      code: "LINT_ERRORS",
      message: "Deterministic lint must report zero ERROR diagnostics",
      details: { errorCount: evidence.lintErrorCount },
    });
  const unapprovedAssets = evidence.assets
    .filter((asset) => asset.rightsStatus !== "approved")
    .map((asset) => ({
      assetId: asset.assetId,
      rightsStatus: asset.rightsStatus,
    }));
  if (unapprovedAssets.length)
    blockers.push({
      code: "ASSET_RIGHTS_NOT_APPROVED",
      message: "Every referenced asset must have rights_status=approved",
      details: { assets: unapprovedAssets },
    });
  const missingArtifacts = Object.entries(evidence.artifacts)
    .filter(([, present]) => present !== true)
    .map(([key]) => key);
  if (missingArtifacts.length)
    blockers.push({
      code: "BUILD_ARTIFACT_MISSING",
      message: `Required build artifacts are missing: ${missingArtifacts.join(", ")}`,
      details: { artifacts: missingArtifacts },
    });
  if (evidence.buildSourceHash !== evidence.sourceHash)
    blockers.push({
      code: "BUILD_SOURCE_MISMATCH",
      message: "The current build was not generated from the current source",
    });
  if (evidence.lintSourceHash !== evidence.sourceHash)
    blockers.push({
      code: "LINT_SOURCE_MISMATCH",
      message: "The lint report does not cover the current source",
    });
  if (evidence.lintRenderedHtmlHash !== evidence.renderedHtmlHash)
    blockers.push({
      code: "LINT_RENDER_MISMATCH",
      message: "The lint report does not cover the current rendered HTML",
    });
  if (evidence.previewSourceHash !== evidence.sourceHash)
    blockers.push({
      code: "PREVIEW_SOURCE_MISMATCH",
      message: "The preview report does not cover the current source",
    });
  if (evidence.previewRenderedHtmlHash !== evidence.renderedHtmlHash)
    blockers.push({
      code: "PREVIEW_RENDER_MISMATCH",
      message: "The preview report does not cover the current rendered HTML",
    });
  if (evidence.previewWechatHtmlHash !== evidence.wechatHtmlHash)
    blockers.push({
      code: "PREVIEW_WECHAT_MISMATCH",
      message:
        "The preview report does not cover the current WeChat-compatible HTML",
    });
  return blockers;
}

/** Determine whether generated evidence is current, without actor/UI concerns. */
export function prepareReview(evidence: ReviewEvidence): ApprovalEligibility {
  const blockers = evidenceBlockers(evidence);
  return { eligible: blockers.length === 0, blockers };
}

/** The one production eligibility decision shared by Web and CLI. */
export function evaluateApprovalEligibility(
  request: ApprovalRequest,
): ApprovalEligibility {
  const blockers = evidenceBlockers(request.evidence);
  if (request.evidence.status !== "reviewed")
    blockers.unshift({
      code: "STATUS_NOT_REVIEWED",
      message: `Article must be reviewed before approval; current status is ${request.evidence.status}`,
    });
  const incomplete = REVIEW_CHECKLIST_KEYS.filter(
    (key) => request.checklist[key] !== true,
  );
  if (incomplete.length)
    blockers.push({
      code: "CHECKLIST_INCOMPLETE",
      message: `Human checklist is incomplete: ${incomplete.join(", ")}`,
      details: { fields: incomplete },
    });
  if (request.actor.actorType !== "human")
    blockers.push({
      code: "ACTOR_NOT_HUMAN",
      message: `Only a human may approve; ${request.actor.actorType || "unknown"} actors are blocked`,
    });
  if (request.actor.explicitHumanAction !== true)
    blockers.push({
      code: "HUMAN_ACTION_NOT_EXPLICIT",
      message: "Approval requires an explicit interactive human action",
    });
  if (!request.actor.actorId.trim())
    blockers.push({
      code: "REVIEWER_ID_MISSING",
      message: "Reviewer identity is required",
    });
  if (request.confirmedSourceHash !== request.evidence.sourceHash)
    blockers.push({
      code: "SOURCE_HASH_NOT_CONFIRMED",
      message: "The human reviewer did not confirm the current source hash",
    });
  if (!request.sourceCommit.trim())
    blockers.push({
      code: "SOURCE_COMMIT_MISSING",
      message: "source_commit is required",
    });
  return { eligible: blockers.length === 0, blockers };
}

export function requestReviewTransition(
  from: ReviewStatus,
  actor: ReviewActor,
): ReviewTransitionResult {
  if (!actor.actorId.trim())
    return { ok: false, from, error: "ACTOR_ID_MISSING" };
  if (from !== "draft")
    return { ok: false, from, error: "INVALID_REVIEW_TRANSITION" };
  return { ok: true, from, to: "reviewing" };
}

export function markReviewedTransition(
  from: ReviewStatus,
  actor: ReviewActor,
): ReviewTransitionResult {
  if (!actor.actorId.trim())
    return { ok: false, from, error: "ACTOR_ID_MISSING" };
  if (from !== "reviewing")
    return { ok: false, from, error: "INVALID_REVIEW_TRANSITION" };
  return { ok: true, from, to: "reviewed" };
}

type HashChainedRecord = {
  previous_record_hash: string | null;
  record_hash: string;
};

export function computeRecordHash(
  record: HashChainedRecord & Record<string, unknown>,
): string {
  const { record_hash: _ignored, ...unsigned } = record;
  return sha256(stableJson(unsigned));
}

export function createApprovalRecord(
  request: ApprovalRequest,
  options: {
    approvalId: string;
    approvedAt: string;
    previousRecordHash: string | null;
  },
): ApprovalRecord {
  const eligibility = evaluateApprovalEligibility(request);
  if (!eligibility.eligible)
    throw new ReviewGateError(
      "APPROVAL_BLOCKED",
      "Approval quality gate failed",
      {
        blockers: eligibility.blockers,
      },
    );
  const unsigned = {
    approval_id: options.approvalId,
    article_id: request.evidence.articleId,
    reviewer_id: request.actor.actorId.trim(),
    reviewer_type: "human" as const,
    approved_at: options.approvedAt,
    source_hash: request.evidence.sourceHash,
    rendered_html_hash: request.evidence.renderedHtmlHash,
    wechat_html_hash: request.evidence.wechatHtmlHash,
    lint_report_hash: request.evidence.lintReportHash,
    assets_manifest_hash: request.evidence.assetsManifestHash,
    theme_hash: request.evidence.themeHash,
    renderer_version: request.evidence.rendererVersion,
    linter_version: request.evidence.linterVersion,
    ruleset_version: request.evidence.rulesetVersion,
    build_settings_hash: request.evidence.buildSettingsHash,
    publish_settings_hash: request.evidence.publishSettingsHash,
    checklist: { ...request.checklist },
    warnings_acknowledged: [...request.warningsAcknowledged],
    source_commit: request.sourceCommit.trim(),
    result: "approved" as const,
    previous_record_hash: options.previousRecordHash,
  };
  return { ...unsigned, record_hash: sha256(stableJson(unsigned)) };
}

export function verifyApprovalChain(
  records: readonly ApprovalRecord[],
): ChainVerification {
  const errors: string[] = [];
  let previous: string | null = null;
  const ids = new Set<string>();
  records.forEach((record, index) => {
    if (ids.has(record.approval_id))
      errors.push(`approval[${index}] has duplicate approval_id`);
    ids.add(record.approval_id);
    if (record.previous_record_hash !== previous)
      errors.push(
        `approval[${index}] previous_record_hash does not match the chain`,
      );
    if (
      computeRecordHash(record as ApprovalRecord & Record<string, unknown>) !==
      record.record_hash
    )
      errors.push(`approval[${index}] record_hash does not match its contents`);
    if (record.reviewer_type !== "human")
      errors.push(`approval[${index}] has a non-human reviewer_type`);
    previous = record.record_hash;
  });
  return { valid: errors.length === 0, errors };
}

function addReason(
  reasons: ApprovalInvalidationReason[],
  condition: boolean,
  reason: ApprovalInvalidationReason,
): void {
  if (condition && !reasons.includes(reason)) reasons.push(reason);
}

export function evaluateApprovalValidity(
  approval: ApprovalRecord,
  current: ReviewEvidence,
): ApprovalValidity {
  const reasons: ApprovalInvalidationReason[] = [];
  addReason(reasons, current.status !== "approved", "status_changed");
  addReason(
    reasons,
    approval.source_hash !== current.sourceHash,
    "source_changed",
  );
  addReason(
    reasons,
    approval.rendered_html_hash !== current.renderedHtmlHash,
    "rendered_html_changed",
  );
  addReason(
    reasons,
    approval.wechat_html_hash !== current.wechatHtmlHash,
    "wechat_html_changed",
  );
  addReason(
    reasons,
    approval.lint_report_hash !== current.lintReportHash,
    "lint_report_changed",
  );
  addReason(
    reasons,
    approval.assets_manifest_hash !== current.assetsManifestHash,
    "assets_manifest_changed",
  );
  addReason(
    reasons,
    approval.theme_hash !== current.themeHash,
    "theme_changed",
  );
  addReason(
    reasons,
    approval.renderer_version !== current.rendererVersion,
    "renderer_version_changed",
  );
  addReason(
    reasons,
    approval.linter_version !== current.linterVersion,
    "linter_version_changed",
  );
  addReason(
    reasons,
    approval.ruleset_version !== current.rulesetVersion,
    "ruleset_version_changed",
  );
  addReason(
    reasons,
    approval.build_settings_hash !== current.buildSettingsHash,
    "build_settings_changed",
  );
  addReason(
    reasons,
    approval.publish_settings_hash !== current.publishSettingsHash,
    "publish_settings_changed",
  );
  addReason(
    reasons,
    current.buildSourceHash !== current.sourceHash,
    "build_source_mismatch",
  );
  addReason(reasons, current.lintErrorCount > 0, "lint_errors_introduced");
  addReason(
    reasons,
    current.assets.some((asset) => asset.rightsStatus !== "approved"),
    "asset_rights_changed",
  );
  addReason(
    reasons,
    Object.values(current.artifacts).some((present) => !present),
    "build_artifact_missing",
  );
  addReason(
    reasons,
    current.previewSourceHash !== current.sourceHash ||
      current.previewRenderedHtmlHash !== current.renderedHtmlHash ||
      current.previewWechatHtmlHash !== current.wechatHtmlHash,
    "preview_stale",
  );
  const requiresDraft = reasons.some((reason) =>
    [
      "source_changed",
      "assets_manifest_changed",
      "theme_changed",
      "renderer_version_changed",
      "linter_version_changed",
      "ruleset_version_changed",
      "build_settings_changed",
      "publish_settings_changed",
      "lint_errors_introduced",
      "asset_rights_changed",
      "status_changed",
    ].includes(reason),
  );
  return {
    valid: reasons.length === 0,
    reasons,
    targetStatus: requiresDraft ? "draft" : "reviewed",
  };
}

export function createInvalidationRecord(input: {
  approval: ApprovalRecord;
  current: ReviewEvidence;
  actor: ReviewActor;
  invalidationId: string;
  invalidatedAt: string;
  previousRecordHash: string | null;
  forcedReason?: "approval_revoked";
}): ApprovalInvalidationRecord {
  const validity = evaluateApprovalValidity(input.approval, input.current);
  const reasons = input.forcedReason ? [input.forcedReason] : validity.reasons;
  if (!reasons.length)
    throw new ReviewGateError(
      "APPROVAL_NOT_STALE",
      "Current approval is still valid",
    );
  const targetStatus = input.forcedReason ? "reviewed" : validity.targetStatus;
  const unsigned = {
    invalidation_id: input.invalidationId,
    previous_approval_id: input.approval.approval_id,
    invalidated_at: input.invalidatedAt,
    reason: reasons[0],
    reasons,
    previous_source_hash: input.approval.source_hash,
    current_source_hash: input.current.sourceHash,
    previous_build_hash: input.approval.rendered_html_hash,
    current_build_hash: input.current.renderedHtmlHash,
    actor: {
      actor_type: input.actor.actorType,
      actor_id: input.actor.actorId.trim(),
    },
    target_status: targetStatus,
    previous_record_hash: input.previousRecordHash,
  };
  return { ...unsigned, record_hash: sha256(stableJson(unsigned)) };
}

export function verifyInvalidationChain(
  records: readonly ApprovalInvalidationRecord[],
): ChainVerification {
  const errors: string[] = [];
  let previous: string | null = null;
  const ids = new Set<string>();
  records.forEach((record, index) => {
    if (ids.has(record.invalidation_id))
      errors.push(`invalidation[${index}] has duplicate invalidation_id`);
    ids.add(record.invalidation_id);
    if (record.previous_record_hash !== previous)
      errors.push(
        `invalidation[${index}] previous_record_hash does not match the chain`,
      );
    if (
      computeRecordHash(
        record as ApprovalInvalidationRecord & Record<string, unknown>,
      ) !== record.record_hash
    )
      errors.push(
        `invalidation[${index}] record_hash does not match its contents`,
      );
    previous = record.record_hash;
  });
  return { valid: errors.length === 0, errors };
}

export function assertHumanRevocation(actor: ReviewActor): void {
  if (
    actor.actorType !== "human" ||
    actor.explicitHumanAction !== true ||
    !actor.actorId.trim()
  )
    throw new ReviewGateError(
      "REVOCATION_REQUIRES_HUMAN",
      "Revoking an approval requires an explicit human action",
    );
}

export function isAutomatedActor(actorType: ActorType): boolean {
  return actorType !== "human";
}
