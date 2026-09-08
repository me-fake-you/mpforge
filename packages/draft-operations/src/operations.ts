import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { newId } from "./crypto.js";
import { DraftOperationError } from "./errors.js";
import { registerPreparedPlan, transitionLedger } from "./ledger.js";
import {
  assertPlanExecutable,
  createDraftOperationPlan,
  verifyPlanIntegrity,
} from "./plan.js";
import {
  assertSafeSegment,
  resolveInside,
  sanitizeForStorage,
} from "./safety.js";
import {
  createSnapshot,
  loadVerifiedSnapshot,
  publishTemporaryOperation,
  verifySnapshot,
} from "./snapshot.js";
import { validateReleaseSource } from "./source.js";
import {
  buildReceipt,
  createInitialStatus,
  initializeOperationFiles,
  readPlan,
  readStatus,
  updateStatus,
  verifyReceiptFile,
  writeAssetUploadMap,
  writeOutcomeArtifacts,
} from "./storage.js";
import type {
  DraftOperationPlan,
  ExecutionOutcomeInput,
  ExecutionSnapshot,
  OperationReceipt,
  PreparedDraftOperation,
  PrepareDraftOperationInput,
  ReconcileOperationInput,
  RecordRemoteAssetInput,
  RemoteAssetRecord,
  SnapshotBinding,
  VerifyExecutionInput,
} from "./types.js";

function roots(input: { workspaceRoot: string; operationsRoot?: string }): {
  workspaceRoot: string;
  operationsRoot: string;
} {
  const workspaceRoot = path.resolve(input.workspaceRoot);
  const operationsRoot = resolveInside(
    workspaceRoot,
    input.operationsRoot ?? path.join(workspaceRoot, "operations"),
    "operationsRoot",
  );
  return { workspaceRoot, operationsRoot };
}

function operationPath(operationsRoot: string, operationId: string): string {
  assertSafeSegment(operationId, "operationId");
  return path.join(operationsRoot, operationId);
}

function requireNonEmpty(value: string, label: string): void {
  if (!value.trim())
    throw new DraftOperationError(
      "SOURCE_ARTIFACT_INVALID",
      `${label} is required`,
    );
}

function parseTimestamp(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed))
    throw new DraftOperationError(
      "SOURCE_ARTIFACT_INVALID",
      `${label} must be an ISO timestamp`,
    );
  return parsed;
}

function bindingMatches(
  plan: DraftOperationPlan,
  binding: SnapshotBinding,
): boolean {
  const fields: Array<keyof SnapshotBinding> = [
    "article_id",
    "account_alias",
    "source_hash",
    "rendered_html_hash",
    "wechat_html_hash",
    "assets_manifest_hash",
    "lint_report_hash",
    "preview_report_hash",
    "approval_id",
    "approval_record_hash",
    "theme_hash",
    "source_commit",
    "adapter_version",
    "platform_contract_version",
  ];
  return fields.every((field) => plan[field] === binding[field]);
}

export async function prepareDraftOperation(
  input: PrepareDraftOperationInput,
): Promise<PreparedDraftOperation> {
  const resolved = roots(input);
  requireNonEmpty(input.accountAlias, "accountAlias");
  requireNonEmpty(input.provider, "provider");
  requireNonEmpty(input.sourceCommit, "sourceCommit");
  requireNonEmpty(input.adapterVersion, "adapterVersion");
  requireNonEmpty(input.platformContractVersion, "platformContractVersion");
  const operationId = input.operationId ?? newId("draft");
  assertSafeSegment(operationId, "operationId");
  const createdAt = input.createdAt ?? new Date().toISOString();
  const createdMs = parseTimestamp(createdAt, "createdAt");
  const expiresAt =
    input.expiresAt ??
    new Date(createdMs + (input.ttlMs ?? 15 * 60 * 1000)).toISOString();
  if (parseTimestamp(expiresAt, "expiresAt") <= createdMs)
    throw new DraftOperationError(
      "SOURCE_ARTIFACT_INVALID",
      "expiresAt must be after createdAt",
    );
  await mkdir(resolved.operationsRoot, { recursive: true });
  const source = await validateReleaseSource({
    workspaceRoot: resolved.workspaceRoot,
    articleDirectory: input.articleDirectory,
    accountAlias: input.accountAlias,
    sourceCommit: input.sourceCommit,
    adapterVersion: input.adapterVersion,
    platformContractVersion: input.platformContractVersion,
    title: input.title,
    coverAssetId: input.coverAssetId,
  });
  const operationDirectory = operationPath(
    resolved.operationsRoot,
    operationId,
  );
  const temporaryDirectory = path.join(
    resolved.operationsRoot,
    `.prepare-${operationId}-${newId("tmp")}`,
  );
  await mkdir(temporaryDirectory, { recursive: false });
  try {
    const snapshot = await createSnapshot({
      temporaryOperationDirectory: temporaryDirectory,
      operationId,
      createdAt,
      source,
    });
    const plan = createDraftOperationPlan({
      operationId,
      mode: input.mode,
      provider: input.provider,
      accountAlias: input.accountAlias,
      title: source.title,
      binding: source.binding,
      bodyImageCount: source.bodyImageCount,
      coverAssetId: source.coverAssetId,
      snapshotInventoryHash: snapshot.inventoryHash,
      createdAt,
      expiresAt,
    });
    const status = createInitialStatus(plan);
    await initializeOperationFiles({
      operationDirectory: temporaryDirectory,
      plan,
      status,
    });
    await registerPreparedPlan(resolved.operationsRoot, plan, async () =>
      publishTemporaryOperation(temporaryDirectory, operationDirectory),
    );
    return {
      operationDirectory,
      snapshotDirectory: path.join(operationDirectory, "snapshot"),
      plan,
      inventory: snapshot.inventory,
      status,
    };
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true }).catch(
      () => undefined,
    );
    throw error;
  }
}

export async function verifyPreparedOperation(
  input: VerifyExecutionInput,
): Promise<{
  operationDirectory: string;
  plan: DraftOperationPlan;
}> {
  const resolved = roots(input);
  const operationDirectory = operationPath(
    resolved.operationsRoot,
    input.operationId,
  );
  const plan = await readPlan(operationDirectory);
  if (plan.operation_id !== input.operationId)
    throw new DraftOperationError(
      "PLAN_TAMPERED",
      "The operation directory and plan id differ",
    );
  assertPlanExecutable(plan, {
    currentAccountAlias: input.currentAccountAlias,
    currentMode: input.currentMode,
    now: input.now ?? new Date().toISOString(),
  });
  await verifySnapshot(operationDirectory, plan);
  const current = await validateReleaseSource({
    workspaceRoot: resolved.workspaceRoot,
    articleDirectory: input.currentArticleDirectory,
    accountAlias: input.currentAccountAlias,
    sourceCommit: plan.source_commit,
    adapterVersion: plan.adapter_version,
    platformContractVersion: plan.platform_contract_version,
    title: plan.title,
    coverAssetId: plan.cover_asset_id,
  });
  if (!bindingMatches(plan, current.binding))
    throw new DraftOperationError(
      "CURRENT_SOURCE_CHANGED",
      "Current article evidence no longer matches the immutable plan",
    );
  const status = await readStatus(operationDirectory);
  if (status.status !== "PREPARED")
    throw new DraftOperationError(
      "OPERATION_NOT_PREPARED",
      `Operation status is ${status.status}, not PREPARED`,
    );
  return { operationDirectory, plan };
}

export async function beginDraftExecution(
  input: VerifyExecutionInput,
): Promise<ExecutionSnapshot> {
  const verified = await verifyPreparedOperation(input);
  const loaded = await loadVerifiedSnapshot(
    verified.operationDirectory,
    verified.plan,
  );
  const at = input.now ?? new Date().toISOString();
  await transitionLedger(
    roots(input).operationsRoot,
    verified.plan,
    "EXECUTING",
    at,
  );
  const status = await updateStatus({
    operationDirectory: verified.operationDirectory,
    plan: verified.plan,
    status: "EXECUTING",
    at,
    eventType: "execution_started",
  });
  return { plan: verified.plan, ...loaded, status };
}

function safeRemoteAssets(assets: RemoteAssetRecord[]): RemoteAssetRecord[] {
  const sanitized = sanitizeForStorage(assets) as RemoteAssetRecord[];
  for (const asset of sanitized) {
    if (
      !asset.asset_id ||
      !["body_image", "cover"].includes(asset.kind) ||
      !Number.isFinite(Date.parse(asset.uploaded_at))
    )
      throw new DraftOperationError(
        "SENSITIVE_OUTPUT_REJECTED",
        "Remote asset evidence is incomplete or unsafe",
      );
  }
  return sanitized;
}

function assertCompleteRemoteAssets(
  plan: DraftOperationPlan,
  assets: RemoteAssetRecord[],
): void {
  const body = assets.filter((asset) => asset.kind === "body_image");
  const covers = assets.filter((asset) => asset.kind === "cover");
  if (
    body.length !== plan.body_image_count ||
    covers.length !== 1 ||
    assets.some((asset) => !asset.remote_id)
  )
    throw new DraftOperationError(
      "INVALID_STATUS_TRANSITION",
      "A definitive draft creation outcome requires the complete body and cover upload map",
      {
        expected_body_images: plan.body_image_count,
        actual_body_images: body.length,
        actual_covers: covers.length,
      },
    );
}

/** Persist each upload immediately so a later failure cannot erase orphan evidence. */
export async function recordDraftRemoteAsset(input: RecordRemoteAssetInput) {
  const resolved = roots(input);
  const operationDirectory = operationPath(
    resolved.operationsRoot,
    input.operationId,
  );
  const plan = await readPlan(operationDirectory);
  verifyPlanIntegrity(plan);
  await verifySnapshot(operationDirectory, plan);
  const current = await readStatus(operationDirectory);
  if (current.status !== "EXECUTING")
    throw new DraftOperationError(
      "INVALID_STATUS_TRANSITION",
      "Remote upload progress can only be recorded while executing",
    );
  const [asset] = safeRemoteAssets([input.asset]);
  const duplicate = current.remote_assets.find(
    (item) => item.asset_id === asset.asset_id && item.kind === asset.kind,
  );
  if (duplicate) {
    if (
      duplicate.remote_id === asset.remote_id &&
      duplicate.remote_url === asset.remote_url
    )
      return current;
    throw new DraftOperationError(
      "INVALID_STATUS_TRANSITION",
      "Conflicting remote evidence exists for this asset",
      { asset_id: asset.asset_id, kind: asset.kind },
    );
  }
  const assets = [...current.remote_assets, asset];
  if (
    assets.filter((item) => item.kind === "body_image").length >
      plan.body_image_count ||
    assets.filter((item) => item.kind === "cover").length > 1
  )
    throw new DraftOperationError(
      "INVALID_STATUS_TRANSITION",
      "Remote upload evidence exceeds the approved operation plan",
    );
  const at = input.at ?? new Date().toISOString();
  await writeAssetUploadMap({
    operationDirectory,
    plan,
    assets,
    at,
  });
  return updateStatus({
    operationDirectory,
    plan,
    status: "EXECUTING",
    at,
    remoteAssets: assets,
    eventType: "remote_asset_recorded",
    eventData: {
      asset_id: asset.asset_id,
      kind: asset.kind,
      safely_reusable: asset.safely_reusable,
    },
  });
}

export async function recordDraftExecutionOutcome(
  input: ExecutionOutcomeInput,
): Promise<OperationReceipt> {
  const resolved = roots(input);
  const operationDirectory = operationPath(
    resolved.operationsRoot,
    input.operationId,
  );
  const plan = await readPlan(operationDirectory);
  verifyPlanIntegrity(plan);
  await verifySnapshot(operationDirectory, plan);
  const current = await readStatus(operationDirectory);
  if (current.status !== "EXECUTING")
    throw new DraftOperationError(
      "INVALID_STATUS_TRANSITION",
      "Only an executing operation can record a remote outcome",
    );
  const assets = safeRemoteAssets(input.remoteAssets ?? current.remote_assets);
  if (input.status === "FAILED_WITH_REMOTE_ASSETS" && assets.length === 0)
    throw new DraftOperationError(
      "INVALID_STATUS_TRANSITION",
      "Remote asset evidence is required for a partial outcome",
    );
  if (input.status === "FAILED" && assets.length > 0)
    throw new DraftOperationError(
      "INVALID_STATUS_TRANSITION",
      "An operation with uploaded remote assets must use the partial outcome",
    );
  if (input.status === "SUCCEEDED" && (!input.remoteDraftId || !input.verified))
    throw new DraftOperationError(
      "INVALID_STATUS_TRANSITION",
      "A successful operation requires a verified remote draft identifier",
    );
  if (["SUCCEEDED", "UNKNOWN_REMOTE_STATE"].includes(input.status))
    assertCompleteRemoteAssets(plan, assets);
  const at = input.at ?? new Date().toISOString();
  const receipt = buildReceipt({
    plan,
    status: input.status,
    remoteAssets: assets,
    remoteDraftId: input.remoteDraftId ?? null,
    reconciliationResult: null,
    at,
    verified: input.verified === true,
    uncertain: input.status === "UNKNOWN_REMOTE_STATE",
    errorCode: input.errorCode ?? null,
  });
  await transitionLedger(resolved.operationsRoot, plan, input.status, at);
  await writeOutcomeArtifacts({
    operationDirectory,
    plan,
    remoteAssets: assets,
    request: input.request,
    response: input.response,
    receipt,
  });
  await updateStatus({
    operationDirectory,
    plan,
    status: input.status,
    at,
    remoteAssets: assets,
    remoteDraftId: input.remoteDraftId ?? null,
    errorCode: input.errorCode ?? null,
    recommendedHumanAction:
      input.status === "FAILED_WITH_REMOTE_ASSETS"
        ? "Review uploaded materials before preparing another operation; no remote deletion was attempted."
        : input.status === "UNKNOWN_REMOTE_STATE"
          ? "Run read-only reconciliation; do not retry creation automatically."
          : null,
    eventType: "execution_outcome_recorded",
    eventData: {
      outcome: input.status,
      remote_asset_count: assets.length,
      orphan_asset_risk:
        input.status === "FAILED_WITH_REMOTE_ASSETS" ||
        input.status === "UNKNOWN_REMOTE_STATE",
    },
  });
  return receipt;
}

export async function reconcileDraftOperation(
  input: ReconcileOperationInput,
): Promise<OperationReceipt | null> {
  if (
    !["CONFIRMED_CREATED", "CONFIRMED_NOT_CREATED", "AMBIGUOUS"].includes(
      input.result,
    )
  )
    throw new DraftOperationError(
      "RECONCILIATION_NOT_ALLOWED",
      "Unsupported reconciliation result",
    );
  const resolved = roots(input);
  const operationDirectory = operationPath(
    resolved.operationsRoot,
    input.operationId,
  );
  const plan = await readPlan(operationDirectory);
  verifyPlanIntegrity(plan);
  await verifySnapshot(operationDirectory, plan);
  const current = await readStatus(operationDirectory);
  if (current.status !== "UNKNOWN_REMOTE_STATE")
    throw new DraftOperationError(
      "RECONCILIATION_NOT_ALLOWED",
      "Only UNKNOWN_REMOTE_STATE operations can be reconciled",
    );
  const at = input.at ?? new Date().toISOString();
  if (input.result === "AMBIGUOUS") {
    await updateStatus({
      operationDirectory,
      plan,
      status: "UNKNOWN_REMOTE_STATE",
      at,
      reconciliationResult: "AMBIGUOUS",
      recommendedHumanAction:
        "Inspect the account administration console manually; automatic retry remains blocked.",
      eventType: "reconciliation_ambiguous",
      eventData: { result: input.result },
    });
    return null;
  }
  if (input.result === "CONFIRMED_CREATED" && !input.remoteDraftId)
    throw new DraftOperationError(
      "RECONCILIATION_REMOTE_ID_REQUIRED",
      "A confirmed created result requires the discovered remote draft identifier",
    );
  const next =
    input.result === "CONFIRMED_CREATED"
      ? ("RECONCILED_SUCCEEDED" as const)
      : ("RECONCILED_NOT_CREATED" as const);
  const remoteDraftId =
    input.result === "CONFIRMED_CREATED" ? input.remoteDraftId! : null;
  const receipt = buildReceipt({
    plan,
    status: next,
    remoteAssets: current.remote_assets,
    remoteDraftId,
    reconciliationResult: input.result,
    at,
    verified: true,
    uncertain: false,
    errorCode: null,
  });
  await transitionLedger(resolved.operationsRoot, plan, next, at);
  await writeOutcomeArtifacts({
    operationDirectory,
    plan,
    remoteAssets: current.remote_assets,
    response: input.response,
    receipt,
    receiptFileName: "reconciliation-receipt.json",
  });
  await updateStatus({
    operationDirectory,
    plan,
    status: next,
    at,
    remoteDraftId,
    reconciliationResult: input.result,
    errorCode: null,
    recommendedHumanAction:
      next === "RECONCILED_NOT_CREATED"
        ? "Prepare a new plan and obtain a new side-effect approval before another attempt."
        : null,
    eventType: "reconciliation_completed",
    eventData: { result: input.result },
  });
  return receipt;
}

export async function cancelDraftOperation(input: {
  workspaceRoot: string;
  operationsRoot?: string;
  operationId: string;
  at?: string;
}): Promise<void> {
  const resolved = roots(input);
  const operationDirectory = operationPath(
    resolved.operationsRoot,
    input.operationId,
  );
  const plan = await readPlan(operationDirectory);
  verifyPlanIntegrity(plan);
  const at = input.at ?? new Date().toISOString();
  await transitionLedger(resolved.operationsRoot, plan, "CANCELLED", at);
  await updateStatus({
    operationDirectory,
    plan,
    status: "CANCELLED",
    at,
    eventType: "operation_cancelled",
  });
}

export async function verifyDraftReceipt(input: {
  workspaceRoot: string;
  operationsRoot?: string;
  operationId: string;
  reconciliation?: boolean;
}): Promise<OperationReceipt> {
  const resolved = roots(input);
  const operationDirectory = operationPath(
    resolved.operationsRoot,
    input.operationId,
  );
  const plan = await readPlan(operationDirectory);
  verifyPlanIntegrity(plan);
  await verifySnapshot(operationDirectory, plan);
  return verifyReceiptFile(
    operationDirectory,
    plan,
    input.reconciliation ? "reconciliation-receipt.json" : "receipt.json",
  );
}

export async function listDraftOperationIds(input: {
  workspaceRoot: string;
  operationsRoot?: string;
}): Promise<string[]> {
  const resolved = roots(input);
  const entries = await readdir(resolved.operationsRoot, {
    withFileTypes: true,
  }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  return entries
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !entry.name.startsWith(".") &&
        /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort();
}
