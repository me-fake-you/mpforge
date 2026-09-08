import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createReleaseFixture } from "./test-fixtures.js";
import {
  beginDraftExecution,
  prepareDraftOperation,
  reconcileDraftOperation,
  recordDraftExecutionOutcome,
  recordDraftRemoteAsset,
  verifyDraftReceipt,
  verifyPreparedOperation,
} from "./operations.js";
import { readLedger } from "./ledger.js";
import { readStatus } from "./storage.js";
import { DraftOperationError } from "./errors.js";
import { sha256, stableJson } from "./crypto.js";

const CREATED = "2026-09-01T00:00:00.000Z";
const EXECUTED = "2026-09-01T00:05:00.000Z";
const EXPIRES = "2026-09-01T00:15:00.000Z";

describe("immutable draft operations", () => {
  let workspaceRoot: string;
  let articleDirectory: string;
  let sourceCommit: string;

  beforeEach(async () => {
    workspaceRoot = path.resolve("tmp", "draft-operation-tests", randomUUID());
    await mkdir(workspaceRoot, { recursive: true });
    ({ articleDirectory, sourceCommit } =
      await createReleaseFixture(workspaceRoot));
  });

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  async function prepare(
    operationId = `draft-${randomUUID()}`,
    overrides: Partial<Parameters<typeof prepareDraftOperation>[0]> = {},
  ) {
    return prepareDraftOperation({
      workspaceRoot,
      articleDirectory,
      accountAlias: "local-mock",
      provider: "mock-wechat",
      mode: "mock",
      sourceCommit,
      adapterVersion: "adapter/1",
      platformContractVersion: "contract/1",
      operationId,
      createdAt: CREATED,
      expiresAt: EXPIRES,
      ...overrides,
    });
  }

  function executionInput(operationId: string) {
    return {
      workspaceRoot,
      operationId,
      currentAccountAlias: "local-mock",
      currentMode: "mock" as const,
      currentArticleDirectory: articleDirectory,
      now: EXECUTED,
    };
  }

  function completeRemoteAssets() {
    return [
      {
        asset_id: "asset-body",
        kind: "body_image" as const,
        remote_id: "mock-image-complete",
        remote_url: "http://mock.local/image/complete",
        uploaded_at: EXECUTED,
        safely_reusable: true,
      },
      {
        asset_id: "asset-body",
        kind: "cover" as const,
        remote_id: "mock-cover-complete",
        remote_url: null,
        uploaded_at: EXECUTED,
        safely_reusable: true,
      },
    ];
  }

  it("freezes every binding and loads execution bytes only from the snapshot", async () => {
    const prepared = await prepare("draft-snapshot");
    expect(prepared.inventory.files.map((item) => item.path)).toEqual(
      expect.arrayContaining([
        "article.md",
        "article.wechat.html",
        "article.meta.json",
        "lint-report.json",
        "assets-manifest.json",
        "preview-report.json",
        "approval-record.json",
        "assets/originals/body.png",
      ]),
    );
    expect(prepared.plan).toMatchObject({
      article_id: "article-1",
      account_alias: "local-mock",
      approval_id: "approval-1",
      body_image_count: 1,
      cover_asset_id: "asset-body",
      status: "PREPARED",
    });
    const started = await beginDraftExecution(executionInput("draft-snapshot"));
    expect(
      Buffer.from(started.files.get("article.wechat.html")!).toString("utf8"),
    ).toContain("Approved fixture");
    expect(started.status.status).toBe("EXECUTING");
  });

  it("fails preparation for lint errors, unapproved rights, and non-approved state", async () => {
    await rm(path.join(workspaceRoot, "content"), {
      recursive: true,
      force: true,
    });
    ({ articleDirectory, sourceCommit } = await createReleaseFixture(
      workspaceRoot,
      {
        lintErrors: 1,
      },
    ));
    await expect(prepare("draft-lint")).rejects.toMatchObject({
      code: "LINTER_ERRORS",
    });
    await rm(path.join(workspaceRoot, "content"), {
      recursive: true,
      force: true,
    });
    ({ articleDirectory, sourceCommit } = await createReleaseFixture(
      workspaceRoot,
      {
        rightsStatus: "pending",
      },
    ));
    await expect(prepare("draft-rights")).rejects.toMatchObject({
      code: "ASSET_RIGHTS_NOT_APPROVED",
    });
    await rm(path.join(workspaceRoot, "content"), {
      recursive: true,
      force: true,
    });
    ({ articleDirectory, sourceCommit } = await createReleaseFixture(
      workspaceRoot,
      {
        status: "reviewed",
      },
    ));
    await expect(prepare("draft-state")).rejects.toMatchObject({
      code: "ARTICLE_NOT_APPROVED",
    });
  });

  it("rejects an invalidated content approval", async () => {
    const approval = JSON.parse(
      (
        await readFile(
          path.join(articleDirectory, "history", "approvals.jsonl"),
          "utf8",
        )
      ).trim(),
    ) as Record<string, unknown>;
    const unsigned = {
      invalidation_id: "invalidation-1",
      previous_approval_id: approval.approval_id,
      invalidated_at: "2026-09-01T00:01:00.000Z",
      reason: "approval_revoked",
      reasons: ["approval_revoked"],
      previous_source_hash: approval.source_hash,
      current_source_hash: approval.source_hash,
      previous_build_hash: approval.rendered_html_hash,
      current_build_hash: approval.rendered_html_hash,
      actor: { actor_type: "human", actor_id: "fixture-human" },
      target_status: "reviewed",
      previous_record_hash: null,
    };
    await writeFile(
      path.join(articleDirectory, "history", "approval-invalidations.jsonl"),
      `${JSON.stringify({
        ...unsigned,
        record_hash: sha256(stableJson(unsigned)),
      })}\n`,
      "utf8",
    );
    await expect(prepare("draft-invalidated")).rejects.toMatchObject({
      code: "APPROVAL_INVALID",
    });
  });

  it("blocks snapshot and plan tampering", async () => {
    const plan = await prepare("draft-tamper-plan");
    const planPath = path.join(plan.operationDirectory, "plan.json");
    const value = JSON.parse(await readFile(planPath, "utf8")) as Record<
      string,
      unknown
    >;
    value.title = "changed";
    await writeFile(planPath, JSON.stringify(value), "utf8");
    await expect(
      verifyPreparedOperation(executionInput("draft-tamper-plan")),
    ).rejects.toMatchObject({ code: "PLAN_TAMPERED" });

    await rm(path.join(workspaceRoot, "operations"), {
      recursive: true,
      force: true,
    });
    const snapshot = await prepare("draft-tamper-snapshot");
    await writeFile(
      path.join(snapshot.snapshotDirectory, "article.wechat.html"),
      "tampered",
      "utf8",
    );
    await expect(
      verifyPreparedOperation(executionInput("draft-tamper-snapshot")),
    ).rejects.toMatchObject({ code: "SNAPSHOT_TAMPERED" });
  });

  it("rejects expiry, account changes, mode changes, and changed source", async () => {
    await prepare("draft-stale");
    await expect(
      verifyPreparedOperation({
        ...executionInput("draft-stale"),
        now: EXPIRES,
      }),
    ).rejects.toMatchObject({ code: "PLAN_EXPIRED" });
    await expect(
      verifyPreparedOperation({
        ...executionInput("draft-stale"),
        currentAccountAlias: "other-account",
      }),
    ).rejects.toMatchObject({ code: "ACCOUNT_CHANGED" });
    await expect(
      verifyPreparedOperation({
        ...executionInput("draft-stale"),
        currentMode: "real",
      }),
    ).rejects.toMatchObject({ code: "MODE_CHANGED" });
    await writeFile(
      path.join(articleDirectory, "article.md"),
      `${await readFile(path.join(articleDirectory, "article.md"), "utf8")}\nchanged\n`,
      "utf8",
    );
    await expect(
      verifyPreparedOperation(executionInput("draft-stale")),
    ).rejects.toBeInstanceOf(DraftOperationError);
  });

  it("serializes concurrent execution so a double click cannot create twice", async () => {
    await prepare("draft-double-click");
    const results = await Promise.allSettled([
      beginDraftExecution(executionInput("draft-double-click")),
      beginDraftExecution(executionInput("draft-double-click")),
    ]);
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(
      1,
    );
    expect(results.filter((item) => item.status === "rejected")).toHaveLength(
      1,
    );
    const ledger = await readLedger(path.join(workspaceRoot, "operations"));
    expect(
      ledger.filter(
        (record) =>
          record.operation_id === "draft-double-click" &&
          record.status === "EXECUTING",
      ),
    ).toHaveLength(1);
  });

  it("records remote assets honestly on partial failure and blocks reuse", async () => {
    await prepare("draft-partial");
    await beginDraftExecution(executionInput("draft-partial"));
    await recordDraftRemoteAsset({
      workspaceRoot,
      operationId: "draft-partial",
      asset: {
        asset_id: "asset-body",
        kind: "body_image",
        remote_id: "remote-image-1",
        remote_url: "http://mock.local/image/1?sig=discarded",
        uploaded_at: EXECUTED,
        safely_reusable: false,
      },
      at: EXECUTED,
    });
    const receipt = await recordDraftExecutionOutcome({
      workspaceRoot,
      operationId: "draft-partial",
      status: "FAILED_WITH_REMOTE_ASSETS",
      errorCode: "COVER_UPLOAD_FAILED",
      at: EXECUTED,
    });
    expect(receipt.orphan_asset_risk).toBe(true);
    const status = await readStatus(
      path.join(workspaceRoot, "operations", "draft-partial"),
    );
    expect(status).toMatchObject({
      status: "FAILED_WITH_REMOTE_ASSETS",
      orphan_asset_risk: true,
    });
    await expect(prepare("draft-partial-again")).rejects.toMatchObject({
      code: "IDEMPOTENCY_PLAN_EXISTS",
    });
  });

  it("blocks uncertain retries and supports only the three reconciliation results", async () => {
    await prepare("draft-unknown");
    await beginDraftExecution(executionInput("draft-unknown"));
    await recordDraftExecutionOutcome({
      workspaceRoot,
      operationId: "draft-unknown",
      status: "UNKNOWN_REMOTE_STATE",
      remoteAssets: completeRemoteAssets(),
      errorCode: "RESPONSE_NOT_DEFINITIVE",
      at: EXECUTED,
    });
    await expect(prepare("draft-unknown-again")).rejects.toMatchObject({
      code: "IDEMPOTENCY_UNKNOWN_STATE",
    });
    expect(
      await reconcileDraftOperation({
        workspaceRoot,
        operationId: "draft-unknown",
        result: "AMBIGUOUS",
        at: "2026-09-01T00:06:00.000Z",
      }),
    ).toBeNull();
    expect(
      (
        await readStatus(
          path.join(workspaceRoot, "operations", "draft-unknown"),
        )
      ).status,
    ).toBe("UNKNOWN_REMOTE_STATE");
    const reconciled = await reconcileDraftOperation({
      workspaceRoot,
      operationId: "draft-unknown",
      result: "CONFIRMED_CREATED",
      remoteDraftId: "mock-draft-1",
      at: "2026-09-01T00:07:00.000Z",
    });
    expect(reconciled).toMatchObject({
      outcome: "RECONCILED_SUCCEEDED",
      reconciliation_result: "CONFIRMED_CREATED",
      remote_draft_id: "mock-draft-1",
    });
  });

  it("allows a fresh plan after reconciliation confirms no draft exists", async () => {
    await prepare("draft-not-created");
    await beginDraftExecution(executionInput("draft-not-created"));
    await recordDraftExecutionOutcome({
      workspaceRoot,
      operationId: "draft-not-created",
      status: "UNKNOWN_REMOTE_STATE",
      remoteAssets: completeRemoteAssets(),
      at: EXECUTED,
    });
    await reconcileDraftOperation({
      workspaceRoot,
      operationId: "draft-not-created",
      result: "CONFIRMED_NOT_CREATED",
      at: "2026-09-01T00:06:00.000Z",
    });
    await expect(prepare("draft-fresh-plan")).resolves.toMatchObject({
      plan: { operation_id: "draft-fresh-plan" },
    });
  });

  it("creates a sanitized hash-bound receipt, detects tampering, and leaves source state unchanged", async () => {
    const before = await readFile(
      path.join(articleDirectory, "article.md"),
      "utf8",
    );
    await prepare("draft-receipt");
    await beginDraftExecution(executionInput("draft-receipt"));
    await recordDraftExecutionOutcome({
      workspaceRoot,
      operationId: "draft-receipt",
      status: "SUCCEEDED",
      remoteDraftId: "mock-draft-2",
      verified: true,
      remoteAssets: [
        {
          asset_id: "asset-body",
          kind: "body_image",
          remote_id: "mock-image-2",
          remote_url: "http://mock.local/image/2?sig=private",
          uploaded_at: EXECUTED,
          safely_reusable: true,
        },
        {
          asset_id: "asset-body",
          kind: "cover",
          remote_id: "mock-cover-2",
          remote_url: null,
          uploaded_at: EXECUTED,
          safely_reusable: true,
        },
      ],
      request: {
        title: "Approved fixture",
        access_token: "must-not-persist",
        endpoint: "http://mock.local/create?sig=private",
      },
      response: { ok: true, authorization: "must-not-persist" },
      at: EXECUTED,
    });
    const receipt = await verifyDraftReceipt({
      workspaceRoot,
      operationId: "draft-receipt",
    });
    expect(receipt).toMatchObject({
      provider_mode: "mock",
      mock: true,
      verification_status: "verified",
    });
    const operationDirectory = path.join(
      workspaceRoot,
      "operations",
      "draft-receipt",
    );
    const request = await readFile(
      path.join(operationDirectory, "request.sanitized.json"),
      "utf8",
    );
    expect(request).not.toContain("must-not-persist");
    expect(request).not.toContain("?sig=");
    expect(
      await readFile(path.join(articleDirectory, "article.md"), "utf8"),
    ).toBe(before);
    const receiptPath = path.join(operationDirectory, "receipt.json");
    const tampered = JSON.parse(await readFile(receiptPath, "utf8")) as Record<
      string,
      unknown
    >;
    tampered.remote_draft_id = "different";
    await writeFile(receiptPath, JSON.stringify(tampered), "utf8");
    await expect(
      verifyDraftReceipt({ workspaceRoot, operationId: "draft-receipt" }),
    ).rejects.toMatchObject({ code: "RECEIPT_TAMPERED" });
  });

  it("blocks a second plan after a successful idempotency key", async () => {
    await prepare("draft-success");
    await beginDraftExecution(executionInput("draft-success"));
    await recordDraftExecutionOutcome({
      workspaceRoot,
      operationId: "draft-success",
      status: "SUCCEEDED",
      remoteDraftId: "mock-draft-success",
      remoteAssets: completeRemoteAssets(),
      verified: true,
      at: EXECUTED,
    });
    await expect(prepare("draft-success-again")).rejects.toMatchObject({
      code: "IDEMPOTENCY_ALREADY_SUCCEEDED",
    });
  });
});
