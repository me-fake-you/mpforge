import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MOCK_FAULTS,
  startMockWechatServer,
  type MockWechatServer,
} from "./server.js";

let service: MockWechatServer;
let dataDir: string;

async function post(
  pathname: string,
  value: Record<string, unknown>,
  fault?: string,
): Promise<Response> {
  return fetch(`${service.url}${pathname}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(fault ? { "x-mpforge-fault": fault } : {}),
    },
    body: JSON.stringify(value),
  });
}

async function upload(
  pathname = "/v1/body-images",
  fault?: string,
): Promise<Response> {
  return post(
    pathname,
    {
      relative_path: "assets/example.png",
      content_hash: "aabbccddeeff",
      mime_type: "image/png",
      data_base64: Buffer.from("mock-image").toString("base64"),
    },
    fault,
  );
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "mpforge-mock-wechat-"));
  service = await startMockWechatServer({
    dataDir,
    testOnlyAllowTempDataDir: true,
    faultDelayMs: 15,
  });
});

afterEach(async () => {
  if (service?.server.listening) await service.close();
  await rm(dataDir, { recursive: true, force: true });
});

describe("mock platform contract", () => {
  it("binds to loopback and marks health JSON as mock", async () => {
    expect(service.url).toMatch(/^http:\/\/127\.0\.0\.1:/);
    const response = await fetch(`${service.url}/health`);
    expect(await json(response)).toMatchObject({
      ok: true,
      mock: true,
      bind: "127.0.0.1",
      persisted: true,
    });
  });

  it("rejects every non-loopback bind request", async () => {
    await expect(
      startMockWechatServer({ host: "0.0.0.0" as "127.0.0.1" }),
    ).rejects.toThrow("MOCK_SERVER_LOOPBACK_ONLY");
  });

  it("reports the complete supported fault inventory", async () => {
    const response = await fetch(`${service.url}/v1/capabilities`);
    const result = await json(response);
    expect(result.mock).toBe(true);
    expect(result.faults).toEqual(MOCK_FAULTS);
    expect(result.operations).toContain("findPossibleDraft");
  });

  it("issues a deterministic mock token without requiring credentials", async () => {
    const first = await json(
      await post("/v1/token", { account_alias: "demo" }),
    );
    const second = await json(
      await post("/v1/token", { account_alias: "demo" }),
    );
    expect(first).toMatchObject({ mock: true, expires_in: 7200 });
    expect(first.access_token).toBe(second.access_token);
    expect(String(first.access_token)).toMatch(/^mock-token-/);
  });

  it("rejects a credential that is not visibly synthetic", async () => {
    const unsafeCredentialFixture = [
      "looks",
      "like",
      "a",
      "real",
      "value",
      "123456789",
    ].join("-");
    const response = await post("/v1/token", {
      account_alias: "demo",
      app_secret: unsafeCredentialFixture,
    });
    expect(response.status).toBe(400);
    expect(await json(response)).toMatchObject({
      mock: true,
      errmsg: "REAL_CREDENTIAL_REJECTED",
    });
    const log = await readFile(path.join(dataDir, "calls.jsonl"), "utf8");
    expect(log).not.toContain("looks-like-a-real-value");
    expect(log).not.toContain("app_secret");
  });

  it.each([
    ["token_failure", 502, "MOCK_TOKEN_FAILURE"],
    ["invalid_credentials", 401, "MOCK_INVALID_CREDENTIALS"],
    ["ip_denied", 403, "MOCK_IP_DENIED"],
    ["permission_denied", 403, "MOCK_PERMISSION_DENIED"],
    ["server_error", 500, "MOCK_SERVER_ERROR"],
    ["rate_limited", 429, "MOCK_RATE_LIMITED"],
  ])("injects %s at the token boundary", async (fault, status, message) => {
    const response = await post("/v1/token", {}, fault);
    expect(response.status).toBe(status);
    expect(await json(response)).toMatchObject({ mock: true, errmsg: message });
  });

  it("uploads body images with both official-style and compatibility ids", async () => {
    const response = await upload();
    expect(response.status).toBe(200);
    const result = await json(response);
    expect(result).toMatchObject({ mock: true });
    expect(result.media_id).toBe(result.mediaId);
    expect(String(result.url)).toContain("/v1/media/");
    expect(service.state.media.size).toBe(1);
    const served = await fetch(`${service.url}${String(result.url)}`);
    expect(served.headers.get("x-mpforge-provider-mode")).toBe("mock");
    expect(Buffer.from(await served.arrayBuffer()).toString()).toBe(
      "mock-image",
    );
  });

  it("fails exactly the configured nth body image", async () => {
    await post("/admin/faults", {
      fault: "body_image_n",
      body_image_failure_at: 2,
    });
    expect((await upload()).status).toBe(200);
    const failed = await upload();
    expect(failed.status).toBe(502);
    expect(await json(failed)).toMatchObject({
      mock: true,
      errmsg: "MOCK_BODY_IMAGE_N_FAILURE",
    });
    expect(service.state.media.size).toBe(1);
  });

  it("injects a cover failure without removing earlier body assets", async () => {
    await upload();
    const response = await upload("/v1/cover-materials", "cover_failure");
    expect(response.status).toBe(502);
    expect(service.state.media.size).toBe(1);
  });

  it("creates, reads, lists, filters, and previews a mock draft", async () => {
    const body = await json(await upload());
    const cover = await json(await upload("/v1/cover-materials"));
    const createResponse = await post("/v1/drafts", {
      operation_id: "op-001",
      plan_hash: "plan-001",
      idempotency_key: "idem-001",
      articles: [
        {
          title: "Local draft",
          author: "MPForge",
          digest: "Safe local mock",
          content: `<p><img src="${body.url}">Hello</p>`,
          thumb_media_id: cover.media_id,
          body_image_media_ids: [body.media_id],
          need_open_comment: 0,
          only_fans_can_comment: 0,
        },
      ],
    });
    expect(createResponse.status).toBe(200);
    const created = await json(createResponse);
    const mediaId = String(created.media_id);

    const one = await json(await fetch(`${service.url}/v1/drafts/${mediaId}`));
    expect(one).toMatchObject({
      mock: true,
      media_id: mediaId,
      operation_id: "op-001",
      plan_hash: "plan-001",
    });
    const list = await json(
      await fetch(
        `${service.url}/v1/drafts?operation_id=op-001&plan_hash=plan-001`,
      ),
    );
    expect(list).toMatchObject({ mock: true, total_count: 1, item_count: 1 });
    const preview = await fetch(`${service.url}/v1/drafts/${mediaId}/preview`);
    expect(preview.headers.get("content-type")).toContain("text/html");
    expect(await preview.text()).toContain("LOCAL MOCK PREVIEW");
  });

  it("returns the same draft for an identical idempotent retry", async () => {
    const request = {
      idempotency_key: "stable-key",
      articles: [{ title: "One", content: "<p>One</p>" }],
    };
    const first = await json(await post("/v1/drafts", request));
    const second = await json(await post("/v1/drafts", request));
    expect(second).toMatchObject({
      mock: true,
      media_id: first.media_id,
      duplicate: true,
    });
    expect(service.state.drafts.size).toBe(1);
  });

  it("rejects reuse of an idempotency key with a different payload", async () => {
    await post("/v1/drafts", {
      idempotency_key: "conflict-key",
      articles: [{ title: "One", content: "<p>One</p>" }],
    });
    const response = await post("/v1/drafts", {
      idempotency_key: "conflict-key",
      articles: [{ title: "Two", content: "<p>Two</p>" }],
    });
    expect(response.status).toBe(409);
    expect(await json(response)).toMatchObject({
      mock: true,
      errmsg: "IDEMPOTENCY_KEY_CONFLICT",
    });
  });

  it("preserves remote assets when draft creation fails", async () => {
    await upload();
    const response = await post(
      "/v1/drafts",
      { articles: [{ title: "Partial", content: "<p>Partial</p>" }] },
      "remote_assets_without_draft",
    );
    expect(response.status).toBe(502);
    expect(service.state.media.size).toBe(1);
    expect(service.state.drafts.size).toBe(0);
  });

  it("does not expose a remote delete operation", async () => {
    const response = await fetch(`${service.url}/v1/media/anything`, {
      method: "DELETE",
    });
    expect(response.status).toBe(405);
    expect(await json(response)).toMatchObject({
      mock: true,
      errmsg: "REMOTE_DELETE_NOT_SUPPORTED",
    });
  });

  it.each([
    ["payload_rejected", 422],
    ["server_error", 500],
    ["duplicate_request", 409],
    ["rate_limited", 429],
    ["permission_denied", 403],
  ])("injects %s during draft creation", async (fault, expectedStatus) => {
    const response = await post(
      "/v1/drafts",
      { articles: [{ title: "Fault", content: "<p>Fault</p>" }] },
      fault,
    );
    expect(response.status).toBe(expectedStatus);
    expect((await json(response)).mock).toBe(true);
    expect(service.state.drafts.size).toBe(0);
  });

  it("returns intentionally malformed data for invalid_json injection", async () => {
    const response = await post("/v1/token", {}, "invalid_json");
    expect(response.status).toBe(502);
    await expect(response.json()).rejects.toThrow();
  });

  it("delays a response for timeout injection", async () => {
    const startedAt = Date.now();
    const response = await post("/v1/token", {}, "timeout");
    expect(response.status).toBe(200);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(10);
  });

  it("reconciles a lost create response after a process restart", async () => {
    const request = {
      idempotency_key: "lost-response-key",
      operation_id: "unknown-op",
      plan_hash: "unknown-plan",
      articles: [{ title: "Unknown", content: "<p>Unknown</p>" }],
    };
    await expect(
      post("/v1/drafts", request, "created_but_response_lost"),
    ).rejects.toThrow();
    await service.close();
    service = await startMockWechatServer({
      dataDir,
      testOnlyAllowTempDataDir: true,
      faultDelayMs: 15,
    });
    const reconciled = await json(
      await fetch(
        `${service.url}/v1/drafts?operation_id=unknown-op&plan_hash=unknown-plan`,
      ),
    );
    expect(reconciled).toMatchObject({ mock: true, total_count: 1 });
    const item = (reconciled.item as Array<Record<string, unknown>>)[0];
    const mediaId = String(item.media_id);
    expect(
      await json(await fetch(`${service.url}/v1/drafts/${mediaId}`)),
    ).toMatchObject({ mock: true, media_id: mediaId });
    expect(await json(await post("/v1/drafts", request))).toMatchObject({
      mock: true,
      media_id: mediaId,
      duplicate: true,
    });
  });

  it("restores uploaded media and sanitized calls after restart", async () => {
    const uploaded = await json(await upload());
    const callCount = service.state.calls.length;
    await service.close();
    service = await startMockWechatServer({
      dataDir,
      testOnlyAllowTempDataDir: true,
    });
    expect(service.state.media.size).toBe(1);
    expect(service.state.calls).toHaveLength(callCount);
    const response = await fetch(`${service.url}${String(uploaded.url)}`);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe(
      "mock-image",
    );
  });

  it("starts empty when the explicitly selected state file is missing", async () => {
    await service.close();
    await rm(dataDir, { recursive: true, force: true });
    service = await startMockWechatServer({
      dataDir,
      testOnlyAllowTempDataDir: true,
    });
    expect(service.state.media.size).toBe(0);
    expect(service.state.drafts.size).toBe(0);
    expect(service.state.calls).toHaveLength(0);
  });

  it("fails closed instead of discarding corrupted persisted state", async () => {
    await service.close();
    await writeFile(path.join(dataDir, "state.json"), "not valid json", "utf8");
    await expect(
      startMockWechatServer({ dataDir, testOnlyAllowTempDataDir: true }),
    ).rejects.toThrow("MOCK_STATE_INVALID");
  });

  it("serves an admin page and accepts admin fault configuration", async () => {
    const configured = await json(
      await post("/admin/faults", { fault: "payload_rejected" }),
    );
    expect(configured).toMatchObject({
      mock: true,
      active_fault: "payload_rejected",
    });
    const page = await fetch(`${service.url}/admin`);
    expect(await page.text()).toContain("LOCAL MOCK ONLY");
  });

  it("persists redacted state, calls, and HTML previews", async () => {
    const created = await json(
      await post("/v1/drafts", {
        articles: [{ title: "Persisted", content: "<p>Persisted</p>" }],
      }),
    );
    const state = await readFile(path.join(dataDir, "state.json"), "utf8");
    const calls = await readFile(path.join(dataDir, "calls.jsonl"), "utf8");
    const preview = await readFile(
      path.join(dataDir, "drafts", `${created.media_id}.html`),
      "utf8",
    );
    expect(state).toContain('"mock": true');
    expect(calls).toContain('"mock":true');
    expect(preview).toContain("Persisted");
  });
});

describe("persistence path policy", () => {
  it("rejects a non-project persistence directory", async () => {
    await expect(
      startMockWechatServer({
        dataDir: path.resolve("outside-mock-data"),
        projectRoot: path.resolve("project-root"),
      }),
    ).rejects.toThrow("MOCK_DATA_DIR_OUTSIDE_ALLOWED_PROJECT_PATHS");
  });
});
