import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ReviewStatus } from "./index.js";
import {
  approveReview,
  invalidateApprovalIfNeeded,
  readApprovalRecords,
  readInvalidationRecords,
  revokeApproval,
  type StatusTransaction,
} from "./node.js";
import { validEvidence, validRequest } from "./test-fixtures.js";

const testRoot = path.resolve(process.cwd(), "packages/review-gate/.test-tmp");

function statusHarness(
  initial: ReviewStatus,
  failWrite = false,
): {
  transaction: StatusTransaction;
  current: () => ReviewStatus;
} {
  let status = initial;
  return {
    transaction: {
      async writeStatus(next) {
        if (failWrite) throw new Error("simulated status failure");
        status = next;
      },
      async restoreStatus(previous) {
        status = previous;
      },
    },
    current: () => status,
  };
}

describe("Node approval JSONL storage", () => {
  beforeEach(async () => {
    await rm(testRoot, { recursive: true, force: true });
    await mkdir(testRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(testRoot, { recursive: true, force: true });
  });

  it("atomically appends approval only before committing approved status", async () => {
    const status = statusHarness("reviewed");
    const record = await approveReview({
      historyDirectory: testRoot,
      request: validRequest(),
      statusTransaction: status.transaction,
      approvalId: "approval-1",
      now: "2026-09-01T00:00:00.000Z",
    });
    expect(status.current()).toBe("approved");
    expect(record.reviewer_type).toBe("human");
    expect(
      (await readApprovalRecords(testRoot)).map((item) => item.approval_id),
    ).toEqual(["approval-1"]);
  });

  it("rolls back the audit record when status persistence fails", async () => {
    const status = statusHarness("reviewed", true);
    await expect(
      approveReview({
        historyDirectory: testRoot,
        request: validRequest(),
        statusTransaction: status.transaction,
      }),
    ).rejects.toThrow("simulated status failure");
    expect(status.current()).toBe("reviewed");
    expect(await readApprovalRecords(testRoot)).toEqual([]);
  });

  it("rejects a tampered JSONL record before appending or trusting it", async () => {
    const status = statusHarness("reviewed");
    await approveReview({
      historyDirectory: testRoot,
      request: validRequest(),
      statusTransaction: status.transaction,
      approvalId: "approval-1",
    });
    const filePath = path.join(testRoot, "approvals.jsonl");
    const raw = await readFile(filePath, "utf8");
    await writeFile(
      filePath,
      raw.replace("human-reviewer", "attacker"),
      "utf8",
    );
    await expect(readApprovalRecords(testRoot)).rejects.toMatchObject({
      code: "AUDIT_CHAIN_INVALID",
    });
  });

  it("automatically invalidates after a source change and returns the article to draft", async () => {
    const status = statusHarness("reviewed");
    await approveReview({
      historyDirectory: testRoot,
      request: validRequest(),
      statusTransaction: status.transaction,
      approvalId: "approval-1",
    });
    const invalidation = await invalidateApprovalIfNeeded({
      historyDirectory: testRoot,
      current: validEvidence({
        status: "approved",
        sourceHash: "source-v2",
        buildSourceHash: "source-v2",
        lintSourceHash: "source-v2",
        previewSourceHash: "source-v2",
      }),
      actor: { actorType: "automation", actorId: "content-watcher" },
      statusTransaction: status.transaction,
      invalidationId: "invalidation-1",
    });
    expect(invalidation?.reasons).toContain("source_changed");
    expect(invalidation?.target_status).toBe("draft");
    expect(status.current()).toBe("draft");
    expect(await readInvalidationRecords(testRoot)).toHaveLength(1);
  });

  it("records explicit human revocation and blocks automated revocation", async () => {
    const status = statusHarness("reviewed");
    await approveReview({
      historyDirectory: testRoot,
      request: validRequest(),
      statusTransaction: status.transaction,
      approvalId: "approval-1",
    });
    const current = validEvidence({ status: "approved" });
    await expect(
      revokeApproval({
        historyDirectory: testRoot,
        current,
        actor: {
          actorType: "ci",
          actorId: "pipeline",
          explicitHumanAction: true,
        },
        statusTransaction: status.transaction,
      }),
    ).rejects.toThrow("explicit human action");
    const record = await revokeApproval({
      historyDirectory: testRoot,
      current,
      actor: {
        actorType: "human",
        actorId: "human-reviewer",
        explicitHumanAction: true,
      },
      statusTransaction: status.transaction,
      invalidationId: "revoke-1",
    });
    expect(record.reason).toBe("approval_revoked");
    expect(record.target_status).toBe("reviewed");
    expect(status.current()).toBe("reviewed");
  });
});
