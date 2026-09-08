import {
  createHash,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

import { SideEffectGateError } from "./errors.js";
import { authorizeExecutionContext } from "./runtime.js";
import type {
  ApprovalBinding,
  GateDependencies,
  HumanApprovalConsumed,
  HumanChallengeDisplay,
  HumanSessionApprovalConsume,
  HumanSessionApprovalRequest,
  PersistedChallengeRecord,
} from "./types.js";

const DEFAULT_TTL_SECONDS = 300;
const MIN_TTL_SECONDS = 30;
const MAX_TTL_SECONDS = 600;
const CODE_DIGITS = 8;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizedBinding(binding: Readonly<ApprovalBinding>): string {
  if (
    !binding.operation_id.trim() ||
    binding.operation_id.length > 160 ||
    !binding.account_alias.trim() ||
    binding.account_alias.length > 160 ||
    !/^[a-f0-9]{64}$/i.test(binding.plan_hash)
  ) {
    throw new SideEffectGateError(
      "INVALID_APPROVAL_BINDING",
      "Approval binding requires an operation, account alias, and SHA-256 plan hash",
    );
  }

  return JSON.stringify({
    operation_id: binding.operation_id,
    account_alias: binding.account_alias,
    plan_hash: binding.plan_hash.toLowerCase(),
  });
}

function recordHash(bindingText: string, code: string): string {
  return sha256(`mpforge-side-effect-v1\0${bindingText}\0${code}`);
}

function equalHash(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return (
    leftBuffer.length === rightBuffer.length &&
    leftBuffer.length > 0 &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function serializeRecord(record: PersistedChallengeRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

function parseRecord(text: string): PersistedChallengeRecord {
  let parsed: Partial<PersistedChallengeRecord>;
  try {
    parsed = JSON.parse(text) as Partial<PersistedChallengeRecord>;
  } catch {
    throw new SideEffectGateError(
      "CHALLENGE_INVALID",
      "The persisted challenge record is invalid",
    );
  }
  const keys = Object.keys(parsed).sort();
  const expected = [
    "code_hash",
    "consumed_at",
    "created_at",
    "expires_at",
  ].sort();
  if (
    keys.length !== expected.length ||
    !keys.every((key, index) => key === expected[index]) ||
    typeof parsed.code_hash !== "string" ||
    !/^[a-f0-9]{64}$/.test(parsed.code_hash) ||
    typeof parsed.created_at !== "string" ||
    typeof parsed.expires_at !== "string" ||
    !(typeof parsed.consumed_at === "string" || parsed.consumed_at === null) ||
    !Number.isFinite(Date.parse(parsed.created_at)) ||
    !Number.isFinite(Date.parse(parsed.expires_at)) ||
    (typeof parsed.consumed_at === "string" &&
      !Number.isFinite(Date.parse(parsed.consumed_at)))
  ) {
    throw new SideEffectGateError(
      "CHALLENGE_INVALID",
      "The persisted challenge record is invalid",
    );
  }
  return parsed as PersistedChallengeRecord;
}

export class FileChallengeStore {
  readonly root_directory: string;

  constructor(rootDirectory: string) {
    this.root_directory = resolve(rootDirectory);
    mkdirSync(this.root_directory, { recursive: true, mode: 0o700 });
  }

  recordPath(binding: Readonly<ApprovalBinding>): string {
    return join(
      this.root_directory,
      `${sha256(normalizedBinding(binding))}.json`,
    );
  }

  create(
    binding: Readonly<ApprovalBinding>,
    record: PersistedChallengeRecord,
  ): void {
    const path = this.recordPath(binding);
    try {
      writeFileSync(path, serializeRecord(record), {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new SideEffectGateError(
          "CHALLENGE_ALREADY_EXISTS",
          "A challenge already exists for this exact operation binding",
        );
      }
      throw error;
    }
  }

  read(binding: Readonly<ApprovalBinding>): PersistedChallengeRecord {
    try {
      return parseRecord(readFileSync(this.recordPath(binding), "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new SideEffectGateError(
          "CHALLENGE_NOT_FOUND",
          "No challenge exists for this exact operation binding",
        );
      }
      throw error;
    }
  }

  consumeAtomically(
    binding: Readonly<ApprovalBinding>,
    code: string,
    now: Date,
  ): PersistedChallengeRecord {
    const path = this.recordPath(binding);
    const lockPath = `${path}.lock`;
    let lockDescriptor: number;
    try {
      lockDescriptor = openSync(lockPath, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new SideEffectGateError(
          "CHALLENGE_BUSY",
          "The challenge is already being consumed",
        );
      }
      throw error;
    }

    try {
      const bindingText = normalizedBinding(binding);
      const record = this.read(binding);
      if (record.consumed_at !== null) {
        throw new SideEffectGateError(
          "CHALLENGE_ALREADY_CONSUMED",
          "The challenge has already been consumed",
        );
      }
      if (Date.parse(record.expires_at) <= now.getTime()) {
        throw new SideEffectGateError(
          "CHALLENGE_EXPIRED",
          "The challenge has expired",
        );
      }
      if (
        !/^\d{8}$/.test(code) ||
        !equalHash(record.code_hash, recordHash(bindingText, code))
      ) {
        throw new SideEffectGateError(
          "CHALLENGE_INVALID",
          "The challenge code does not match this operation binding",
        );
      }

      const consumed: PersistedChallengeRecord = {
        ...record,
        consumed_at: now.toISOString(),
      };
      const temporaryPath = join(
        dirname(path),
        `.${sha256(path)}.${randomBytes(8).toString("hex")}.tmp`,
      );
      writeFileSync(temporaryPath, serializeRecord(consumed), {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      renameSync(temporaryPath, path);
      return consumed;
    } finally {
      closeSync(lockDescriptor);
      rmSync(lockPath, { force: true });
    }
  }
}

export async function prepareHumanSideEffectApproval(
  request: Readonly<HumanSessionApprovalRequest>,
  store: FileChallengeStore,
  dependencies: Readonly<GateDependencies> = {},
): Promise<HumanChallengeDisplay> {
  const now = request.now ?? new Date();
  const decision = await authorizeExecutionContext(
    request.context,
    dependencies,
    now,
  );
  if (decision.provider_mode !== "real") {
    throw new SideEffectGateError(
      "REAL_CONTEXT_REQUIRED",
      "Human side-effect approval is only issued for real execution",
    );
  }

  const bindingText = normalizedBinding(request.binding);
  const ttlSeconds = request.ttl_seconds ?? DEFAULT_TTL_SECONDS;
  if (
    !Number.isInteger(ttlSeconds) ||
    ttlSeconds < MIN_TTL_SECONDS ||
    ttlSeconds > MAX_TTL_SECONDS
  ) {
    throw new SideEffectGateError(
      "INVALID_CHALLENGE_TTL",
      `Challenge TTL must be ${MIN_TTL_SECONDS}-${MAX_TTL_SECONDS} seconds`,
    );
  }

  const code = randomInt(0, 10 ** CODE_DIGITS)
    .toString()
    .padStart(CODE_DIGITS, "0");
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
  store.create(request.binding, {
    code_hash: recordHash(bindingText, code),
    created_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    consumed_at: null,
  });

  return {
    challenge_code: code,
    operation_id: request.binding.operation_id,
    account_alias: request.binding.account_alias,
    plan_hash: request.binding.plan_hash.toLowerCase(),
    expires_at: expiresAt.toISOString(),
  };
}

export async function consumeHumanSideEffectApproval(
  request: Readonly<HumanSessionApprovalConsume>,
  store: FileChallengeStore,
  dependencies: Readonly<GateDependencies> = {},
): Promise<HumanApprovalConsumed> {
  const now = request.now ?? new Date();
  await authorizeExecutionContext(request.context, dependencies, now);

  if (
    (request.context.surface === "cli" &&
      request.submitted_by !== "human-tty") ||
    (request.context.surface === "web" &&
      request.submitted_by !== "human-web-form")
  ) {
    throw new SideEffectGateError(
      "CHALLENGE_SUBMITTER_MISMATCH",
      "The challenge submitter does not match the verified human surface",
    );
  }

  const record = store.consumeAtomically(
    request.binding,
    request.challenge_code,
    now,
  );
  return {
    operation_id: request.binding.operation_id,
    account_alias: request.binding.account_alias,
    plan_hash: request.binding.plan_hash.toLowerCase(),
    consumed_at: record.consumed_at as string,
  };
}
