import { isSha256, sha256, stableJson } from "./crypto.js";
import { DraftOperationError } from "./errors.js";
import type {
  DraftOperationMode,
  DraftOperationPlan,
  SnapshotBinding,
} from "./types.js";

type UnsignedPlan = Omit<DraftOperationPlan, "plan_hash">;

export function computeIdempotencyKey(input: {
  provider: string;
  accountAlias: string;
  articleId: string;
  sourceHash: string;
  wechatHtmlHash: string;
  assetsManifestHash: string;
  approvalId: string;
}): string {
  return sha256(
    stableJson({
      provider: input.provider,
      account_alias: input.accountAlias,
      article_id: input.articleId,
      source_hash: input.sourceHash,
      wechat_html_hash: input.wechatHtmlHash,
      assets_manifest_hash: input.assetsManifestHash,
      approval_id: input.approvalId,
    }),
  );
}

export function computePlanHash(
  plan: DraftOperationPlan | UnsignedPlan,
): string {
  const { plan_hash: _ignored, ...unsigned } = plan as DraftOperationPlan;
  return sha256(stableJson(unsigned));
}

export function createDraftOperationPlan(input: {
  operationId: string;
  mode: DraftOperationMode;
  provider: string;
  accountAlias: string;
  title: string;
  binding: SnapshotBinding;
  bodyImageCount: number;
  coverAssetId: string;
  snapshotInventoryHash: string;
  createdAt: string;
  expiresAt: string;
}): DraftOperationPlan {
  const remoteCalls = {
    session_obtainment: 1 as const,
    body_image_uploads: input.bodyImageCount,
    cover_uploads: 1 as const,
    draft_creations: 1 as const,
    read_only_verifications: 1 as const,
    total: input.bodyImageCount + 4,
  };
  const unsigned: UnsignedPlan = {
    operation_id: input.operationId,
    mode: input.mode,
    provider: input.provider,
    account_alias: input.accountAlias,
    article_id: input.binding.article_id,
    title: input.title,
    source_hash: input.binding.source_hash,
    rendered_html_hash: input.binding.rendered_html_hash,
    wechat_html_hash: input.binding.wechat_html_hash,
    assets_manifest_hash: input.binding.assets_manifest_hash,
    lint_report_hash: input.binding.lint_report_hash,
    preview_report_hash: input.binding.preview_report_hash,
    approval_id: input.binding.approval_id,
    approval_record_hash: input.binding.approval_record_hash,
    theme_hash: input.binding.theme_hash,
    source_commit: input.binding.source_commit,
    adapter_version: input.binding.adapter_version,
    platform_contract_version: input.binding.platform_contract_version,
    body_image_count: input.bodyImageCount,
    cover_asset_id: input.coverAssetId,
    expected_remote_calls: remoteCalls,
    expected_side_effects: [
      `Read server-side credentials for account alias ${input.accountAlias}`,
      `Upload ${input.bodyImageCount} body image(s)`,
      "Upload one cover material",
      "Create one new account draft",
      "Perform one read-only verification",
      "No existing draft will be deleted or overwritten",
      "No content will be delivered to followers",
    ],
    warnings: [
      "Remote media can remain if a later step fails.",
      "A result without a definitive response requires read-only reconciliation.",
    ],
    orphan_asset_risk: true,
    idempotency_key: computeIdempotencyKey({
      provider: input.provider,
      accountAlias: input.accountAlias,
      articleId: input.binding.article_id,
      sourceHash: input.binding.source_hash,
      wechatHtmlHash: input.binding.wechat_html_hash,
      assetsManifestHash: input.binding.assets_manifest_hash,
      approvalId: input.binding.approval_id,
    }),
    snapshot_inventory_hash: input.snapshotInventoryHash,
    created_at: input.createdAt,
    expires_at: input.expiresAt,
    status: "PREPARED",
  };
  return { ...unsigned, plan_hash: computePlanHash(unsigned) };
}

export function verifyPlanIntegrity(plan: DraftOperationPlan): void {
  const requiredStrings: Array<keyof DraftOperationPlan> = [
    "operation_id",
    "provider",
    "account_alias",
    "article_id",
    "title",
    "approval_id",
    "cover_asset_id",
    "source_commit",
    "adapter_version",
    "platform_contract_version",
  ];
  const hashFields: Array<keyof DraftOperationPlan> = [
    "source_hash",
    "rendered_html_hash",
    "wechat_html_hash",
    "assets_manifest_hash",
    "lint_report_hash",
    "preview_report_hash",
    "approval_record_hash",
    "theme_hash",
    "idempotency_key",
    "snapshot_inventory_hash",
    "plan_hash",
  ];
  if (
    !plan ||
    typeof plan !== "object" ||
    !requiredStrings.every(
      (field) => typeof plan[field] === "string" && String(plan[field]).trim(),
    ) ||
    !hashFields.every((field) => isSha256(plan[field])) ||
    !["mock", "real"].includes(plan.mode) ||
    plan.status !== "PREPARED" ||
    !Number.isInteger(plan.body_image_count) ||
    plan.body_image_count < 0 ||
    !Array.isArray(plan.expected_side_effects) ||
    !Array.isArray(plan.warnings) ||
    !plan.expected_remote_calls ||
    plan.expected_remote_calls.body_image_uploads !== plan.body_image_count ||
    plan.expected_remote_calls.total !== plan.body_image_count + 4
  )
    throw new DraftOperationError(
      "PLAN_TAMPERED",
      "The operation plan schema or required bindings are invalid",
    );
  if (computePlanHash(plan) !== plan.plan_hash)
    throw new DraftOperationError(
      "PLAN_TAMPERED",
      "The operation plan hash does not match its contents",
    );
  if (
    !Number.isFinite(Date.parse(plan.created_at)) ||
    !Number.isFinite(Date.parse(plan.expires_at)) ||
    Date.parse(plan.expires_at) <= Date.parse(plan.created_at)
  )
    throw new DraftOperationError(
      "PLAN_TAMPERED",
      "The operation plan has invalid timestamps",
    );
  const expectedKey = computeIdempotencyKey({
    provider: plan.provider,
    accountAlias: plan.account_alias,
    articleId: plan.article_id,
    sourceHash: plan.source_hash,
    wechatHtmlHash: plan.wechat_html_hash,
    assetsManifestHash: plan.assets_manifest_hash,
    approvalId: plan.approval_id,
  });
  if (expectedKey !== plan.idempotency_key)
    throw new DraftOperationError(
      "PLAN_TAMPERED",
      "The operation idempotency binding is invalid",
    );
}

export function assertPlanExecutable(
  plan: DraftOperationPlan,
  input: {
    currentAccountAlias: string;
    currentMode: DraftOperationMode;
    now: string;
  },
): void {
  verifyPlanIntegrity(plan);
  if (plan.account_alias !== input.currentAccountAlias)
    throw new DraftOperationError(
      "ACCOUNT_CHANGED",
      "The selected account no longer matches the approved operation plan",
    );
  if (plan.mode !== input.currentMode)
    throw new DraftOperationError(
      "MODE_CHANGED",
      "The selected provider mode no longer matches the operation plan",
    );
  if (
    !Number.isFinite(Date.parse(input.now)) ||
    Date.parse(input.now) >= Date.parse(plan.expires_at)
  )
    throw new DraftOperationError(
      "PLAN_EXPIRED",
      "The operation plan has expired and must be prepared again",
    );
}
