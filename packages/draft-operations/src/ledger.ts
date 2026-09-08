import { mkdir, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { newId, sha256, stableJson } from "./crypto.js";
import { DraftOperationError } from "./errors.js";
import type {
  DraftOperationPlan,
  DraftOperationStatus,
  LedgerRecord,
} from "./types.js";

const LEDGER_FILE = "ledger.jsonl";
const LOCK_FILE = ".ledger.lock";

function parseLedger(raw: string): LedgerRecord[] {
  const records: LedgerRecord[] = [];
  let previous: string | null = null;
  raw.split(/\r?\n/u).forEach((line, index) => {
    if (!line.trim()) return;
    try {
      const record = JSON.parse(line) as LedgerRecord;
      const { record_hash: recordHash, ...unsigned } = record;
      if (
        record.schema !== "mpforge.operation-ledger/v1" ||
        record.previous_record_hash !== previous ||
        sha256(stableJson(unsigned)) !== recordHash
      )
        throw new Error("hash chain mismatch");
      records.push(record);
      previous = recordHash;
    } catch (error) {
      throw new DraftOperationError(
        "LEDGER_INVALID",
        `Operation ledger line ${index + 1} is invalid`,
        { reason: error instanceof Error ? error.message : String(error) },
      );
    }
  });
  return records;
}

export async function readLedger(
  operationsRoot: string,
): Promise<LedgerRecord[]> {
  const raw = await readFile(
    path.join(operationsRoot, LEDGER_FILE),
    "utf8",
  ).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  return parseLedger(raw);
}

async function acquireLock(
  operationsRoot: string,
): Promise<() => Promise<void>> {
  await mkdir(operationsRoot, { recursive: true });
  const lockPath = path.join(operationsRoot, LOCK_FILE);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx");
      await handle.writeFile(
        JSON.stringify({ pid: process.pid, nonce: newId("lock") }),
        "utf8",
      );
      await handle.sync();
      await handle.close();
      return async () => unlink(lockPath).catch(() => undefined);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new DraftOperationError(
    "LEDGER_LOCKED",
    "The operation ledger is locked by another transaction",
  );
}

async function appendRecord(
  operationsRoot: string,
  plan: DraftOperationPlan,
  status: DraftOperationStatus,
  previousRecordHash: string | null,
  at: string,
): Promise<LedgerRecord> {
  const unsigned = {
    schema: "mpforge.operation-ledger/v1" as const,
    operation_id: plan.operation_id,
    idempotency_key: plan.idempotency_key,
    plan_hash: plan.plan_hash,
    provider: plan.provider,
    account_alias: plan.account_alias,
    article_id: plan.article_id,
    status,
    at,
    previous_record_hash: previousRecordHash,
  };
  const record: LedgerRecord = {
    ...unsigned,
    record_hash: sha256(stableJson(unsigned)),
  };
  const handle = await open(path.join(operationsRoot, LEDGER_FILE), "a");
  try {
    await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  return record;
}

function latestForKey(
  records: LedgerRecord[],
  key: string,
): LedgerRecord | undefined {
  return [...records]
    .reverse()
    .find((record) => record.idempotency_key === key);
}

function idempotencyBlock(record: LedgerRecord): DraftOperationError | null {
  if (["SUCCEEDED", "RECONCILED_SUCCEEDED"].includes(record.status))
    return new DraftOperationError(
      "IDEMPOTENCY_ALREADY_SUCCEEDED",
      "This exact approved content already has a successful draft operation",
      { operation_id: record.operation_id },
    );
  if (record.status === "EXECUTING")
    return new DraftOperationError(
      "IDEMPOTENCY_IN_PROGRESS",
      "This exact approved content already has an operation in progress",
      { operation_id: record.operation_id },
    );
  if (record.status === "UNKNOWN_REMOTE_STATE")
    return new DraftOperationError(
      "IDEMPOTENCY_UNKNOWN_STATE",
      "An uncertain operation must be reconciled before another plan is prepared",
      { operation_id: record.operation_id },
    );
  if (["PREPARED", "FAILED_WITH_REMOTE_ASSETS"].includes(record.status))
    return new DraftOperationError(
      "IDEMPOTENCY_PLAN_EXISTS",
      "An operation plan or unresolved remote asset risk already exists",
      { operation_id: record.operation_id, status: record.status },
    );
  return null;
}

export async function registerPreparedPlan(
  operationsRoot: string,
  plan: DraftOperationPlan,
  publish: () => Promise<void>,
): Promise<LedgerRecord> {
  const release = await acquireLock(operationsRoot);
  try {
    const records = await readLedger(operationsRoot);
    const prior = latestForKey(records, plan.idempotency_key);
    const blocker = prior ? idempotencyBlock(prior) : null;
    if (blocker) throw blocker;
    await publish();
    return await appendRecord(
      operationsRoot,
      plan,
      "PREPARED",
      records.at(-1)?.record_hash ?? null,
      plan.created_at,
    );
  } finally {
    await release();
  }
}

const TRANSITIONS: Readonly<
  Record<DraftOperationStatus, DraftOperationStatus[]>
> = {
  PREPARED: ["EXECUTING", "CANCELLED"],
  EXECUTING: [
    "SUCCEEDED",
    "FAILED",
    "FAILED_WITH_REMOTE_ASSETS",
    "UNKNOWN_REMOTE_STATE",
  ],
  UNKNOWN_REMOTE_STATE: ["RECONCILED_SUCCEEDED", "RECONCILED_NOT_CREATED"],
  SUCCEEDED: [],
  FAILED: [],
  FAILED_WITH_REMOTE_ASSETS: [],
  RECONCILED_SUCCEEDED: [],
  RECONCILED_NOT_CREATED: [],
  CANCELLED: [],
};

export async function transitionLedger(
  operationsRoot: string,
  plan: DraftOperationPlan,
  next: DraftOperationStatus,
  at: string,
): Promise<LedgerRecord> {
  const release = await acquireLock(operationsRoot);
  try {
    const records = await readLedger(operationsRoot);
    const latestOperation = [...records]
      .reverse()
      .find((record) => record.operation_id === plan.operation_id);
    if (!latestOperation)
      throw new DraftOperationError(
        "OPERATION_NOT_PREPARED",
        "The operation does not exist in the idempotency ledger",
      );
    if (latestOperation.plan_hash !== plan.plan_hash)
      throw new DraftOperationError(
        "LEDGER_INVALID",
        "The ledger plan binding does not match the operation plan",
      );
    const latestKey = latestForKey(records, plan.idempotency_key);
    if (next === "EXECUTING" && latestKey?.operation_id !== plan.operation_id) {
      const blocker = latestKey ? idempotencyBlock(latestKey) : null;
      if (blocker) throw blocker;
    }
    if (!TRANSITIONS[latestOperation.status].includes(next)) {
      if (latestOperation.status === "EXECUTING" && next === "EXECUTING")
        throw new DraftOperationError(
          "IDEMPOTENCY_IN_PROGRESS",
          "The operation is already executing",
        );
      throw new DraftOperationError(
        "INVALID_STATUS_TRANSITION",
        `Cannot transition ${latestOperation.status} to ${next}`,
      );
    }
    return await appendRecord(
      operationsRoot,
      plan,
      next,
      records.at(-1)?.record_hash ?? null,
      at,
    );
  } finally {
    await release();
  }
}

export const OPERATION_LEDGER_FILE = LEDGER_FILE;
