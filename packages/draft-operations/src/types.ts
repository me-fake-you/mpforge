export type DraftOperationMode = "mock" | "real";

export type DraftOperationStatus =
  | "PREPARED"
  | "EXECUTING"
  | "SUCCEEDED"
  | "FAILED"
  | "FAILED_WITH_REMOTE_ASSETS"
  | "UNKNOWN_REMOTE_STATE"
  | "RECONCILED_SUCCEEDED"
  | "RECONCILED_NOT_CREATED"
  | "CANCELLED";

export type ReconciliationResult =
  | "CONFIRMED_CREATED"
  | "CONFIRMED_NOT_CREATED"
  | "AMBIGUOUS";

export interface SnapshotBinding {
  article_id: string;
  account_alias: string;
  source_hash: string;
  rendered_html_hash: string;
  wechat_html_hash: string;
  assets_manifest_hash: string;
  lint_report_hash: string;
  preview_report_hash: string;
  approval_id: string;
  approval_record_hash: string;
  theme_hash: string;
  source_commit: string;
  adapter_version: string;
  platform_contract_version: string;
}

export interface SnapshotFileEntry {
  path: string;
  sha256: string;
  size: number;
}

export interface SnapshotInventory {
  schema: "mpforge.operation-snapshot/v1";
  operation_id: string;
  created_at: string;
  binding: SnapshotBinding;
  files: SnapshotFileEntry[];
}

export interface ExpectedRemoteCalls {
  session_obtainment: 1;
  body_image_uploads: number;
  cover_uploads: 1;
  draft_creations: 1;
  read_only_verifications: 1;
  total: number;
}

export interface DraftOperationPlan extends SnapshotBinding {
  operation_id: string;
  mode: DraftOperationMode;
  provider: string;
  account_alias: string;
  article_id: string;
  title: string;
  source_hash: string;
  wechat_html_hash: string;
  approval_id: string;
  body_image_count: number;
  cover_asset_id: string;
  expected_remote_calls: ExpectedRemoteCalls;
  expected_side_effects: string[];
  warnings: string[];
  orphan_asset_risk: boolean;
  idempotency_key: string;
  snapshot_inventory_hash: string;
  created_at: string;
  expires_at: string;
  plan_hash: string;
  status: "PREPARED";
}

export interface RemoteAssetRecord {
  asset_id: string;
  kind: "body_image" | "cover";
  remote_id: string | null;
  remote_url: string | null;
  uploaded_at: string;
  safely_reusable: boolean;
}

export interface OperationStatusRecord {
  schema: "mpforge.operation-status/v1";
  operation_id: string;
  plan_hash: string;
  status: DraftOperationStatus;
  sequence: number;
  updated_at: string;
  orphan_asset_risk: boolean;
  remote_assets: RemoteAssetRecord[];
  remote_draft_id: string | null;
  reconciliation_result: ReconciliationResult | null;
  error_code: string | null;
  recommended_human_action: string | null;
  status_hash: string;
}

export interface OperationEvent {
  schema: "mpforge.operation-event/v1";
  event_id: string;
  operation_id: string;
  sequence: number;
  at: string;
  type: string;
  status: DraftOperationStatus;
  data: Record<string, unknown>;
  previous_event_hash: string | null;
  event_hash: string;
}

export interface LedgerRecord {
  schema: "mpforge.operation-ledger/v1";
  operation_id: string;
  idempotency_key: string;
  plan_hash: string;
  provider: string;
  account_alias: string;
  article_id: string;
  status: DraftOperationStatus;
  at: string;
  previous_record_hash: string | null;
  record_hash: string;
}

export interface OperationReceipt extends SnapshotBinding {
  schema: "mpforge.draft-receipt/v1";
  receipt_id: string;
  operation_id: string;
  provider: string;
  provider_mode: DraftOperationMode;
  plan_hash: string;
  snapshot_inventory_hash: string;
  outcome: DraftOperationStatus;
  mock: boolean;
  remote_draft_id: string | null;
  remote_assets: RemoteAssetRecord[];
  orphan_asset_risk: boolean;
  reconciliation_result: ReconciliationResult | null;
  created_at: string;
  verified_at: string | null;
  verification_status: "not_checked" | "verified" | "uncertain";
  error_code: string | null;
  receipt_hash: string;
}

export interface AssetUploadMap {
  schema: "mpforge.asset-upload-map/v1";
  operation_id: string;
  provider_mode: DraftOperationMode;
  assets: RemoteAssetRecord[];
  created_at: string;
}

export interface PrepareDraftOperationInput {
  workspaceRoot: string;
  operationsRoot?: string;
  articleDirectory: string;
  accountAlias: string;
  provider: string;
  mode: DraftOperationMode;
  sourceCommit: string;
  adapterVersion: string;
  platformContractVersion: string;
  operationId?: string;
  title?: string;
  coverAssetId?: string;
  createdAt?: string;
  expiresAt?: string;
  ttlMs?: number;
}

export interface PreparedDraftOperation {
  operationDirectory: string;
  snapshotDirectory: string;
  plan: DraftOperationPlan;
  inventory: SnapshotInventory;
  status: OperationStatusRecord;
}

export interface VerifyExecutionInput {
  workspaceRoot: string;
  operationsRoot?: string;
  operationId: string;
  currentAccountAlias: string;
  currentMode: DraftOperationMode;
  currentArticleDirectory: string;
  now?: string;
}

export interface ExecutionSnapshot {
  plan: DraftOperationPlan;
  inventory: SnapshotInventory;
  files: ReadonlyMap<string, Uint8Array>;
  status: OperationStatusRecord;
}

export interface ExecutionOutcomeInput {
  workspaceRoot: string;
  operationsRoot?: string;
  operationId: string;
  status:
    | "SUCCEEDED"
    | "FAILED"
    | "FAILED_WITH_REMOTE_ASSETS"
    | "UNKNOWN_REMOTE_STATE";
  remoteAssets?: RemoteAssetRecord[];
  remoteDraftId?: string | null;
  errorCode?: string | null;
  request?: unknown;
  response?: unknown;
  verified?: boolean;
  at?: string;
}

export interface RecordRemoteAssetInput {
  workspaceRoot: string;
  operationsRoot?: string;
  operationId: string;
  asset: RemoteAssetRecord;
  at?: string;
}

export interface ReconcileOperationInput {
  workspaceRoot: string;
  operationsRoot?: string;
  operationId: string;
  result: ReconciliationResult;
  remoteDraftId?: string | null;
  response?: unknown;
  at?: string;
}
