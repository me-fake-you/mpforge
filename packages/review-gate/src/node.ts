import { randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  ReviewGateError,
  assertHumanRevocation,
  createApprovalRecord,
  createInvalidationRecord,
  evaluateApprovalValidity,
  verifyApprovalChain,
  verifyInvalidationChain,
} from "./core.js";
import type {
  ApprovalInvalidationRecord,
  ApprovalRecord,
  ApprovalRequest,
  ReviewActor,
  ReviewEvidence,
  ReviewStatus,
} from "./types.js";

export class ReviewGateStorageError extends Error {
  constructor(
    readonly code:
      | "AUDIT_JSON_INVALID"
      | "AUDIT_CHAIN_INVALID"
      | "AUDIT_WRITE_FAILED"
      | "REVIEW_GATE_LOCKED"
      | "NO_APPROVAL",
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ReviewGateStorageError";
  }
}

export interface StatusTransaction {
  /** Persist the canonical article status. Throw if the write did not commit. */
  writeStatus(status: ReviewStatus): Promise<void>;
  /** Restore the previous status if a later step fails. */
  restoreStatus(status: ReviewStatus): Promise<void>;
}

export interface ApprovalStorageOptions {
  historyDirectory: string;
  request: ApprovalRequest;
  statusTransaction: StatusTransaction;
  now?: string;
  approvalId?: string;
}

export interface InvalidationStorageOptions {
  historyDirectory: string;
  current: ReviewEvidence;
  actor: ReviewActor;
  statusTransaction: StatusTransaction;
  now?: string;
  invalidationId?: string;
}

export interface RevokeStorageOptions extends InvalidationStorageOptions {}

const APPROVALS_FILE = "approvals.jsonl";
const INVALIDATIONS_FILE = "approval-invalidations.jsonl";

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function parseJsonLines<T>(raw: string, label: string): T[] {
  const records: T[] = [];
  raw.split(/\r?\n/u).forEach((line, index) => {
    if (!line.trim()) return;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error("not an object");
      records.push(parsed as T);
    } catch (error) {
      throw new ReviewGateStorageError(
        "AUDIT_JSON_INVALID",
        `${label} line ${index + 1} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
  return records;
}

export async function readApprovalRecords(
  historyDirectory: string,
): Promise<ApprovalRecord[]> {
  const filePath = path.join(historyDirectory, APPROVALS_FILE);
  const raw = await readFile(filePath, "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    },
  );
  const records = parseJsonLines<ApprovalRecord>(raw, APPROVALS_FILE);
  const chain = verifyApprovalChain(records);
  if (!chain.valid)
    throw new ReviewGateStorageError(
      "AUDIT_CHAIN_INVALID",
      "Approval audit chain failed verification",
      { errors: chain.errors },
    );
  return records;
}

export async function readInvalidationRecords(
  historyDirectory: string,
): Promise<ApprovalInvalidationRecord[]> {
  const filePath = path.join(historyDirectory, INVALIDATIONS_FILE);
  const raw = await readFile(filePath, "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    },
  );
  const records = parseJsonLines<ApprovalInvalidationRecord>(
    raw,
    INVALIDATIONS_FILE,
  );
  const chain = verifyInvalidationChain(records);
  if (!chain.valid)
    throw new ReviewGateStorageError(
      "AUDIT_CHAIN_INVALID",
      "Approval invalidation audit chain failed verification",
      { errors: chain.errors },
    );
  return records;
}

async function syncParent(directory: string): Promise<void> {
  try {
    const handle = await open(directory, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (process.platform !== "win32") throw error;
  }
}

async function atomicReplace(
  filePath: string,
  content: string,
  createBackup: boolean,
): Promise<{ existed: boolean; previous: string }> {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const existed = await fileExists(filePath);
  const previous = existed ? await readFile(filePath, "utf8") : "";
  if (createBackup && existed) {
    const backupDirectory = path.join(directory, "backups");
    await mkdir(backupDirectory, { recursive: true });
    await writeFile(
      path.join(
        backupDirectory,
        `${path.basename(filePath)}.${Date.now()}.${randomUUID()}.bak`,
      ),
      previous,
      { encoding: "utf8", flag: "wx" },
    );
  }
  const temporary = path.join(
    directory,
    `.${path.basename(filePath)}.${randomUUID()}.tmp`,
  );
  const handle = await open(temporary, "wx");
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, filePath);
    await syncParent(directory);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw new ReviewGateStorageError(
      "AUDIT_WRITE_FAILED",
      `Could not atomically replace ${path.basename(filePath)}`,
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }
  return { existed, previous };
}

async function restoreSnapshot(
  filePath: string,
  snapshot: { existed: boolean; previous: string },
): Promise<void> {
  if (!snapshot.existed) {
    await rm(filePath, { force: true });
    return;
  }
  await atomicReplace(filePath, snapshot.previous, false);
}

async function acquireHistoryLock(
  historyDirectory: string,
): Promise<() => Promise<void>> {
  await mkdir(historyDirectory, { recursive: true });
  const lockPath = path.join(historyDirectory, ".review-gate.lock");
  try {
    const handle = await open(lockPath, "wx");
    await handle.writeFile(
      JSON.stringify({
        pid: process.pid,
        created_at: new Date().toISOString(),
      }),
      "utf8",
    );
    await handle.sync();
    await handle.close();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new ReviewGateStorageError(
        "REVIEW_GATE_LOCKED",
        "Another review-gate transaction is in progress",
      );
    throw error;
  }
  return async () => unlink(lockPath).catch(() => undefined);
}

function serializeAppend(previous: string, record: object): string {
  const prefix =
    previous && !previous.endsWith("\n") ? `${previous}\n` : previous;
  return `${prefix}${JSON.stringify(record)}\n`;
}

function assertActorId(actor: ReviewActor): void {
  if (!actor.actorId.trim())
    throw new ReviewGateStorageError(
      "AUDIT_WRITE_FAILED",
      "Audit actor id is required",
    );
}

async function latestActiveApproval(
  historyDirectory: string,
): Promise<ApprovalRecord> {
  const [approvals, invalidations] = await Promise.all([
    readApprovalRecords(historyDirectory),
    readInvalidationRecords(historyDirectory),
  ]);
  const invalidated = new Set(
    invalidations.map((record) => record.previous_approval_id),
  );
  const active = [...approvals]
    .reverse()
    .find((record) => !invalidated.has(record.approval_id));
  if (!active)
    throw new ReviewGateStorageError(
      "NO_APPROVAL",
      "No active approval record exists",
    );
  return active;
}

/**
 * Persist an approval and then commit canonical article status. No test-only or
 * automated bypass exists: this always calls the shared human eligibility gate.
 */
export async function approveReview(
  options: ApprovalStorageOptions,
): Promise<ApprovalRecord> {
  const release = await acquireHistoryLock(options.historyDirectory);
  const approvalPath = path.join(options.historyDirectory, APPROVALS_FILE);
  let snapshot: { existed: boolean; previous: string } | undefined;
  try {
    const approvals = await readApprovalRecords(options.historyDirectory);
    const previousHash = approvals.at(-1)?.record_hash ?? null;
    const record = createApprovalRecord(options.request, {
      approvalId: options.approvalId ?? randomUUID(),
      approvedAt: options.now ?? new Date().toISOString(),
      previousRecordHash: previousHash,
    });
    const currentRaw = await readFile(approvalPath, "utf8").catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return "";
        throw error;
      },
    );
    snapshot = await atomicReplace(
      approvalPath,
      serializeAppend(currentRaw, record),
      true,
    );
    try {
      await options.statusTransaction.writeStatus("approved");
    } catch (error) {
      await options.statusTransaction
        .restoreStatus("reviewed")
        .catch(() => undefined);
      await restoreSnapshot(approvalPath, snapshot);
      throw error;
    }
    return record;
  } finally {
    await release();
  }
}

async function persistInvalidation(
  options: InvalidationStorageOptions,
  approval: ApprovalRecord,
  forcedReason?: "approval_revoked",
): Promise<ApprovalInvalidationRecord> {
  assertActorId(options.actor);
  const invalidationPath = path.join(
    options.historyDirectory,
    INVALIDATIONS_FILE,
  );
  const invalidations = await readInvalidationRecords(options.historyDirectory);
  if (
    invalidations.some(
      (record) => record.previous_approval_id === approval.approval_id,
    )
  )
    throw new ReviewGateStorageError(
      "NO_APPROVAL",
      "The latest approval is already invalidated",
    );
  const previousHash = invalidations.at(-1)?.record_hash ?? null;
  const record = createInvalidationRecord({
    approval,
    current: options.current,
    actor: options.actor,
    invalidationId: options.invalidationId ?? randomUUID(),
    invalidatedAt: options.now ?? new Date().toISOString(),
    previousRecordHash: previousHash,
    forcedReason,
  });
  const currentRaw = await readFile(invalidationPath, "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    },
  );
  const snapshot = await atomicReplace(
    invalidationPath,
    serializeAppend(currentRaw, record),
    true,
  );
  try {
    await options.statusTransaction.writeStatus(record.target_status);
  } catch (error) {
    await options.statusTransaction
      .restoreStatus("approved")
      .catch(() => undefined);
    await restoreSnapshot(invalidationPath, snapshot);
    throw error;
  }
  return record;
}

/** Detect all bound hash/version changes and invalidate the approval if needed. */
export async function invalidateApprovalIfNeeded(
  options: InvalidationStorageOptions,
): Promise<ApprovalInvalidationRecord | null> {
  const release = await acquireHistoryLock(options.historyDirectory);
  try {
    const approval = await latestActiveApproval(options.historyDirectory);
    if (evaluateApprovalValidity(approval, options.current).valid) return null;
    return await persistInvalidation(options, approval);
  } finally {
    await release();
  }
}

/** A revoke is also append-only and requires an explicit human action. */
export async function revokeApproval(
  options: RevokeStorageOptions,
): Promise<ApprovalInvalidationRecord> {
  assertHumanRevocation(options.actor);
  const release = await acquireHistoryLock(options.historyDirectory);
  try {
    const approval = await latestActiveApproval(options.historyDirectory);
    return await persistInvalidation(options, approval, "approval_revoked");
  } finally {
    await release();
  }
}

export { ReviewGateError };
