import {
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { newId, prettyStableJson, sha256, stableJson } from "./crypto.js";
import { DraftOperationError } from "./errors.js";
import { assertNoSensitiveOutput, sanitizeForStorage } from "./safety.js";
import type {
  AssetUploadMap,
  DraftOperationPlan,
  DraftOperationStatus,
  OperationEvent,
  OperationReceipt,
  OperationStatusRecord,
  ReconciliationResult,
  RemoteAssetRecord,
} from "./types.js";

const PLAN_FILE = "plan.json";
const STATUS_FILE = "status.json";
const EVENTS_FILE = "events.jsonl";

async function writeExclusiveJson(
  filePath: string,
  value: unknown,
): Promise<void> {
  assertNoSensitiveOutput(value);
  await writeFile(filePath, prettyStableJson(value), {
    encoding: "utf8",
    flag: "wx",
  });
}

async function replaceJson(filePath: string, value: unknown): Promise<void> {
  assertNoSensitiveOutput(value);
  const temporary = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${newId("tmp")}`,
  );
  await writeFile(temporary, prettyStableJson(value), {
    encoding: "utf8",
    flag: "wx",
  });
  try {
    await rename(temporary, filePath);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

function computeStatusHash(
  status: Omit<OperationStatusRecord, "status_hash"> | OperationStatusRecord,
): string {
  const { status_hash: _ignored, ...unsigned } =
    status as OperationStatusRecord;
  return sha256(stableJson(unsigned));
}

export function createInitialStatus(
  plan: DraftOperationPlan,
): OperationStatusRecord {
  const unsigned: Omit<OperationStatusRecord, "status_hash"> = {
    schema: "mpforge.operation-status/v1",
    operation_id: plan.operation_id,
    plan_hash: plan.plan_hash,
    status: "PREPARED",
    sequence: 1,
    updated_at: plan.created_at,
    orphan_asset_risk: false,
    remote_assets: [],
    remote_draft_id: null,
    reconciliation_result: null,
    error_code: null,
    recommended_human_action: null,
  };
  return { ...unsigned, status_hash: computeStatusHash(unsigned) };
}

export async function initializeOperationFiles(input: {
  operationDirectory: string;
  plan: DraftOperationPlan;
  status: OperationStatusRecord;
}): Promise<void> {
  await mkdir(input.operationDirectory, { recursive: true });
  await writeExclusiveJson(
    path.join(input.operationDirectory, PLAN_FILE),
    input.plan,
  );
  await writeExclusiveJson(
    path.join(input.operationDirectory, STATUS_FILE),
    input.status,
  );
  await appendEvent(input.operationDirectory, {
    operationId: input.plan.operation_id,
    status: "PREPARED",
    at: input.plan.created_at,
    type: "operation_prepared",
    data: {
      plan_hash: input.plan.plan_hash,
      snapshot_inventory_hash: input.plan.snapshot_inventory_hash,
    },
  });
}

function parseObject<T>(raw: string, label: string): T {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("expected an object");
    return value as T;
  } catch (error) {
    throw new DraftOperationError("PLAN_TAMPERED", `${label} is invalid JSON`, {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function readPlan(
  operationDirectory: string,
): Promise<DraftOperationPlan> {
  return parseObject<DraftOperationPlan>(
    await readFile(path.join(operationDirectory, PLAN_FILE), "utf8"),
    PLAN_FILE,
  );
}

export async function readStatus(
  operationDirectory: string,
): Promise<OperationStatusRecord> {
  const status = parseObject<OperationStatusRecord>(
    await readFile(path.join(operationDirectory, STATUS_FILE), "utf8"),
    STATUS_FILE,
  );
  if (
    status.schema !== "mpforge.operation-status/v1" ||
    status.status_hash !== computeStatusHash(status)
  )
    throw new DraftOperationError(
      "PLAN_TAMPERED",
      "The operation status record was modified outside the state machine",
    );
  return status;
}

async function acquireEventLock(
  operationDirectory: string,
): Promise<() => Promise<void>> {
  const lockPath = path.join(operationDirectory, ".events.lock");
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx");
      await handle.close();
      return async () => unlink(lockPath).catch(() => undefined);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new DraftOperationError(
    "EVENT_CHAIN_INVALID",
    "The operation event log is locked",
  );
}

export async function readEvents(
  operationDirectory: string,
): Promise<OperationEvent[]> {
  const raw = await readFile(
    path.join(operationDirectory, EVENTS_FILE),
    "utf8",
  ).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  const events: OperationEvent[] = [];
  let previous: string | null = null;
  raw.split(/\r?\n/u).forEach((line, index) => {
    if (!line.trim()) return;
    try {
      const event = JSON.parse(line) as OperationEvent;
      const { event_hash: eventHash, ...unsigned } = event;
      if (
        event.schema !== "mpforge.operation-event/v1" ||
        event.sequence !== events.length + 1 ||
        event.previous_event_hash !== previous ||
        sha256(stableJson(unsigned)) !== eventHash
      )
        throw new Error("hash chain mismatch");
      events.push(event);
      previous = eventHash;
    } catch (error) {
      throw new DraftOperationError(
        "EVENT_CHAIN_INVALID",
        `Operation event line ${index + 1} is invalid`,
        { reason: error instanceof Error ? error.message : String(error) },
      );
    }
  });
  return events;
}

export async function appendEvent(
  operationDirectory: string,
  input: {
    operationId: string;
    status: DraftOperationStatus;
    at: string;
    type: string;
    data?: Record<string, unknown>;
  },
): Promise<OperationEvent> {
  const release = await acquireEventLock(operationDirectory);
  try {
    const events = await readEvents(operationDirectory);
    const safeData = sanitizeForStorage(input.data ?? {}) as Record<
      string,
      unknown
    >;
    assertNoSensitiveOutput(safeData);
    const unsigned = {
      schema: "mpforge.operation-event/v1" as const,
      event_id: newId("event"),
      operation_id: input.operationId,
      sequence: events.length + 1,
      at: input.at,
      type: input.type,
      status: input.status,
      data: safeData,
      previous_event_hash: events.at(-1)?.event_hash ?? null,
    };
    const event: OperationEvent = {
      ...unsigned,
      event_hash: sha256(stableJson(unsigned)),
    };
    const handle = await open(path.join(operationDirectory, EVENTS_FILE), "a");
    try {
      await handle.writeFile(`${JSON.stringify(event)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    return event;
  } finally {
    await release();
  }
}

export async function updateStatus(input: {
  operationDirectory: string;
  plan: DraftOperationPlan;
  status: DraftOperationStatus;
  at: string;
  remoteAssets?: RemoteAssetRecord[];
  remoteDraftId?: string | null;
  reconciliationResult?: ReconciliationResult | null;
  errorCode?: string | null;
  recommendedHumanAction?: string | null;
  eventType: string;
  eventData?: Record<string, unknown>;
}): Promise<OperationStatusRecord> {
  const previous = await readStatus(input.operationDirectory);
  const remoteAssets = input.remoteAssets ?? previous.remote_assets;
  const unsigned: Omit<OperationStatusRecord, "status_hash"> = {
    schema: "mpforge.operation-status/v1",
    operation_id: input.plan.operation_id,
    plan_hash: input.plan.plan_hash,
    status: input.status,
    sequence: previous.sequence + 1,
    updated_at: input.at,
    orphan_asset_risk:
      input.status === "FAILED_WITH_REMOTE_ASSETS" ||
      input.status === "UNKNOWN_REMOTE_STATE" ||
      (previous.orphan_asset_risk && input.status !== "RECONCILED_SUCCEEDED"),
    remote_assets: remoteAssets,
    remote_draft_id:
      input.remoteDraftId === undefined
        ? previous.remote_draft_id
        : input.remoteDraftId,
    reconciliation_result:
      input.reconciliationResult === undefined
        ? previous.reconciliation_result
        : input.reconciliationResult,
    error_code:
      input.errorCode === undefined ? previous.error_code : input.errorCode,
    recommended_human_action:
      input.recommendedHumanAction === undefined
        ? previous.recommended_human_action
        : input.recommendedHumanAction,
  };
  const status = { ...unsigned, status_hash: computeStatusHash(unsigned) };
  await replaceJson(path.join(input.operationDirectory, STATUS_FILE), status);
  await appendEvent(input.operationDirectory, {
    operationId: input.plan.operation_id,
    status: input.status,
    at: input.at,
    type: input.eventType,
    data: input.eventData,
  });
  return status;
}

function computeReceiptHash(
  receipt: Omit<OperationReceipt, "receipt_hash"> | OperationReceipt,
): string {
  const { receipt_hash: _ignored, ...unsigned } = receipt as OperationReceipt;
  return sha256(stableJson(unsigned));
}

export function buildReceipt(input: {
  plan: DraftOperationPlan;
  status: DraftOperationStatus;
  remoteAssets: RemoteAssetRecord[];
  remoteDraftId: string | null;
  reconciliationResult: ReconciliationResult | null;
  at: string;
  verified: boolean;
  uncertain: boolean;
  errorCode: string | null;
}): OperationReceipt {
  const safeAssets = sanitizeForStorage(
    input.remoteAssets,
  ) as RemoteAssetRecord[];
  const unsigned: Omit<OperationReceipt, "receipt_hash"> = {
    schema: "mpforge.draft-receipt/v1",
    receipt_id: newId("receipt"),
    operation_id: input.plan.operation_id,
    provider: input.plan.provider,
    provider_mode: input.plan.mode,
    account_alias: input.plan.account_alias,
    article_id: input.plan.article_id,
    source_hash: input.plan.source_hash,
    rendered_html_hash: input.plan.rendered_html_hash,
    wechat_html_hash: input.plan.wechat_html_hash,
    assets_manifest_hash: input.plan.assets_manifest_hash,
    lint_report_hash: input.plan.lint_report_hash,
    preview_report_hash: input.plan.preview_report_hash,
    approval_id: input.plan.approval_id,
    approval_record_hash: input.plan.approval_record_hash,
    theme_hash: input.plan.theme_hash,
    source_commit: input.plan.source_commit,
    adapter_version: input.plan.adapter_version,
    platform_contract_version: input.plan.platform_contract_version,
    plan_hash: input.plan.plan_hash,
    snapshot_inventory_hash: input.plan.snapshot_inventory_hash,
    outcome: input.status,
    mock: input.plan.mode === "mock",
    remote_draft_id: input.remoteDraftId,
    remote_assets: safeAssets,
    orphan_asset_risk:
      input.status === "FAILED_WITH_REMOTE_ASSETS" ||
      input.status === "UNKNOWN_REMOTE_STATE" ||
      (input.status === "RECONCILED_NOT_CREATED" && safeAssets.length > 0),
    reconciliation_result: input.reconciliationResult,
    created_at: input.at,
    verified_at: input.verified ? input.at : null,
    verification_status: input.verified
      ? "verified"
      : input.uncertain
        ? "uncertain"
        : "not_checked",
    error_code: input.errorCode,
  };
  assertNoSensitiveOutput(unsigned);
  return { ...unsigned, receipt_hash: computeReceiptHash(unsigned) };
}

export async function writeOutcomeArtifacts(input: {
  operationDirectory: string;
  plan: DraftOperationPlan;
  remoteAssets: RemoteAssetRecord[];
  request?: unknown;
  response?: unknown;
  receipt: OperationReceipt;
  receiptFileName?: "receipt.json" | "reconciliation-receipt.json";
}): Promise<void> {
  const map: AssetUploadMap = {
    schema: "mpforge.asset-upload-map/v1",
    operation_id: input.plan.operation_id,
    provider_mode: input.plan.mode,
    assets: sanitizeForStorage(input.remoteAssets) as RemoteAssetRecord[],
    created_at: input.receipt.created_at,
  };
  assertNoSensitiveOutput(map);
  if (input.receiptFileName !== "reconciliation-receipt.json") {
    await replaceJson(
      path.join(input.operationDirectory, "asset-upload-map.json"),
      map,
    );
    await writeExclusiveJson(
      path.join(input.operationDirectory, "request.sanitized.json"),
      sanitizeForStorage(input.request ?? {}),
    );
    await writeExclusiveJson(
      path.join(input.operationDirectory, "response.sanitized.json"),
      sanitizeForStorage(input.response ?? {}),
    );
  } else if (input.response !== undefined) {
    await writeExclusiveJson(
      path.join(
        input.operationDirectory,
        "reconciliation-response.sanitized.json",
      ),
      sanitizeForStorage(input.response),
    );
  }
  await writeExclusiveJson(
    path.join(
      input.operationDirectory,
      input.receiptFileName ?? "receipt.json",
    ),
    input.receipt,
  );
}

export async function writeAssetUploadMap(input: {
  operationDirectory: string;
  plan: DraftOperationPlan;
  assets: RemoteAssetRecord[];
  at: string;
}): Promise<AssetUploadMap> {
  const map: AssetUploadMap = {
    schema: "mpforge.asset-upload-map/v1",
    operation_id: input.plan.operation_id,
    provider_mode: input.plan.mode,
    assets: sanitizeForStorage(input.assets) as RemoteAssetRecord[],
    created_at: input.at,
  };
  assertNoSensitiveOutput(map);
  await replaceJson(
    path.join(input.operationDirectory, "asset-upload-map.json"),
    map,
  );
  return map;
}

export async function verifyReceiptFile(
  operationDirectory: string,
  plan: DraftOperationPlan,
  fileName: "receipt.json" | "reconciliation-receipt.json" = "receipt.json",
): Promise<OperationReceipt> {
  const receipt = parseObject<OperationReceipt>(
    await readFile(path.join(operationDirectory, fileName), "utf8"),
    fileName,
  );
  assertNoSensitiveOutput(receipt);
  const bindingsMatch =
    receipt.provider === plan.provider &&
    receipt.provider_mode === plan.mode &&
    receipt.mock === (plan.mode === "mock") &&
    receipt.account_alias === plan.account_alias &&
    receipt.article_id === plan.article_id &&
    receipt.source_hash === plan.source_hash &&
    receipt.rendered_html_hash === plan.rendered_html_hash &&
    receipt.wechat_html_hash === plan.wechat_html_hash &&
    receipt.assets_manifest_hash === plan.assets_manifest_hash &&
    receipt.lint_report_hash === plan.lint_report_hash &&
    receipt.preview_report_hash === plan.preview_report_hash &&
    receipt.approval_id === plan.approval_id &&
    receipt.approval_record_hash === plan.approval_record_hash &&
    receipt.theme_hash === plan.theme_hash &&
    receipt.source_commit === plan.source_commit &&
    receipt.adapter_version === plan.adapter_version &&
    receipt.platform_contract_version === plan.platform_contract_version;
  if (
    receipt.schema !== "mpforge.draft-receipt/v1" ||
    computeReceiptHash(receipt) !== receipt.receipt_hash ||
    !bindingsMatch ||
    receipt.operation_id !== plan.operation_id ||
    receipt.plan_hash !== plan.plan_hash ||
    receipt.snapshot_inventory_hash !== plan.snapshot_inventory_hash
  )
    throw new DraftOperationError(
      "RECEIPT_TAMPERED",
      "The draft receipt hash or operation binding is invalid",
    );
  return receipt;
}

export const OPERATION_PLAN_FILE = PLAN_FILE;
export const OPERATION_STATUS_FILE = STATUS_FILE;
export const OPERATION_EVENTS_FILE = EVENTS_FILE;
