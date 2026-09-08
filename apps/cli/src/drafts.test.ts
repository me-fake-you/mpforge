import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createReleaseFixture } from "../../../packages/draft-operations/src/test-fixtures.js";
import {
  executeDraft,
  getDraftOperation,
  prepareDraft,
  reconcileDraft,
} from "./drafts.js";

const temporaryRoots: string[] = [];

const accountYaml = (alias: string) => `alias: ${alias}
provider: wechat
mode: mock
display_name: Local Mock
app_id_env: MPFORGE_MOCK_APP_ID
app_secret_env: MPFORGE_MOCK_APP_SECRET
enabled: true
capability_status: mock_verified
capability_checked_at: "2026-09-01T00:00:00.000Z"
`;

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "mpforge-round3-cli-"));
  temporaryRoots.push(root);
  await mkdir(path.join(root, "config", "accounts"), { recursive: true });
  await createReleaseFixture(root);
  await Promise.all([
    writeFile(
      path.join(root, "config", "accounts", "local-mock.yaml"),
      accountYaml("local-mock"),
      "utf8",
    ),
    writeFile(
      path.join(root, "config", "accounts", "local-mock-reconcile.yaml"),
      accountYaml("local-mock-reconcile"),
      "utf8",
    ),
  ]);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Round 3 CLI draft orchestration", () => {
  it("prepares an immutable snapshot and completes a verified mock draft", async () => {
    const root = await fixtureRoot();
    const prepared = await prepareDraft(root, "release", {
      mode: "mock",
    });
    const receipt = await executeDraft(root, prepared.plan.operation_id);
    expect(receipt).toMatchObject({
      mock: true,
      provider_mode: "mock",
      outcome: "SUCCEEDED",
      verification_status: "verified",
      orphan_asset_risk: false,
    });
    expect(receipt.remote_assets).toHaveLength(2);
    expect(receipt.remote_draft_id).toMatch(/^mock-draft-/u);
  });

  it("persists an uncertain creation and reconciles it without retrying", async () => {
    const root = await fixtureRoot();
    const prepared = await prepareDraft(root, "release", {
      mode: "mock",
      accountAlias: "local-mock-reconcile",
    });
    const uncertain = await executeDraft(root, prepared.plan.operation_id, {
      fault: "created_but_response_lost",
    });
    expect(uncertain.outcome).toBe("UNKNOWN_REMOTE_STATE");
    const result = await reconcileDraft(root, prepared.plan.operation_id);
    expect(result.result).toBe("CONFIRMED_CREATED");
    expect(result.receipt?.outcome).toBe("RECONCILED_SUCCEEDED");
  });

  it("blocks repeat execution of the same operation", async () => {
    const root = await fixtureRoot();
    const prepared = await prepareDraft(root, "release", {
      mode: "mock",
    });
    await executeDraft(root, prepared.plan.operation_id);
    await expect(
      executeDraft(root, prepared.plan.operation_id),
    ).rejects.toMatchObject({ code: "OPERATION_NOT_PREPARED" });
    expect(
      (await getDraftOperation(root, prepared.plan.operation_id)).status.status,
    ).toBe("SUCCEEDED");
  });
});
