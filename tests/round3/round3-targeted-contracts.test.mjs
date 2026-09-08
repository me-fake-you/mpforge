import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  MockProvider,
  RealDraftProvider,
} from "../../packages/wechat-adapter/dist/index.js";
import { authorizeExecutionContext } from "../../packages/side-effect-gate/dist/index.js";
import {
  MOCK_FAULTS,
  startMockWechatServer,
} from "../../apps/mock-wechat/dist/server.js";
import { TOOL_DEFINITIONS } from "../../apps/mcp/dist/server.js";
import { scanText } from "../../scripts/check-secrets.mjs";

const root = path.resolve(import.meta.dirname, "../..");

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("expired token code 42001 is a non-retryable credential failure", async () => {
  const provider = new RealDraftProvider({
    credentialProvider: async () => ({
      appId: "wx_synthetic_app",
      appSecret: "synthetic-server-value",
    }),
    fetch: async () => json({ errcode: 42001, errmsg: "expired" }),
  });
  await assert.rejects(provider.obtainAccessToken(), (error) => {
    assert.equal(error.code, 42001);
    assert.equal(error.category, "CREDENTIAL");
    assert.equal(error.retryable, false);
    assert.equal(error.uncertainSideEffect, false);
    return true;
  });
});

test("pre-draft token timeout leaves no draft and performs no create retry", async () => {
  const dataDir = path.join(
    root,
    "tmp",
    "mock-wechat",
    `round3-qa-${randomUUID()}`,
  );
  await mkdir(dataDir, { recursive: true });
  const service = await startMockWechatServer({
    dataDir,
    projectRoot: root,
    faultDelayMs: 150,
  });
  try {
    await assert.rejects(
      fetch(`${service.url}/v1/token`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-mpforge-fault": "timeout",
        },
        body: JSON.stringify({ account_alias: "mock-local" }),
        signal: AbortSignal.timeout(15),
      }),
    );
    assert.equal(service.state.drafts.size, 0);
    assert.equal(
      service.state.calls.filter((call) => call.path === "/v1/drafts").length,
      0,
    );
  } finally {
    await service.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("token query values are redacted without mutating the original", () => {
  const provider = new RealDraftProvider({
    credentialProvider: async () => undefined,
    fetch: async () => json({}),
  });
  const original = {
    endpoint:
      "https://api.weixin.qq.com/cgi-bin/draft/get?access_token=synthetic-token-value&offset=0",
    nested: { authorization: "synthetic-bearer-value" },
  };
  const sanitized = provider.sanitizeRequest(original);
  assert.notEqual(sanitized, original);
  assert.equal(original.nested.authorization, "synthetic-bearer-value");
  assert.equal(sanitized.nested.authorization, "[REDACTED]");
  assert.doesNotMatch(sanitized.endpoint, /synthetic-token-value/);
  assert.match(sanitized.endpoint, /REDACTED/);
});

test("MCP, CI, and agent surfaces all reject real execution", async () => {
  const cases = [
    ["mcp", "MCP_BLOCKED"],
    ["ci", "CI_BLOCKED"],
    ["agent", "AGENT_BLOCKED"],
  ];
  for (const [surface, code] of cases) {
    await assert.rejects(
      authorizeExecutionContext({ provider_mode: "real", surface }),
      (error) => {
        assert.equal(error.code, code);
        return true;
      },
    );
  }
});

test("provider prototypes expose only the approved draft contract methods", () => {
  const approved = [
    "getCapabilities",
    "validateConfiguration",
    "obtainAccessToken",
    "uploadBodyImage",
    "uploadCoverMaterial",
    "createDraft",
    "getDraft",
    "listDrafts",
    "findPossibleDraft",
    "sanitizeRequest",
    "sanitizeResponse",
  ].sort();
  for (const provider of [MockProvider, RealDraftProvider]) {
    const methods = Object.getOwnPropertyNames(provider.prototype)
      .filter((name) => name !== "constructor")
      .sort();
    assert.deepEqual(methods, approved);
  }
});

test("mock fault inventory contains every required deterministic fault", () => {
  assert.deepEqual(
    [...MOCK_FAULTS],
    [
      "token_failure",
      "invalid_credentials",
      "ip_denied",
      "permission_denied",
      "body_image_n",
      "cover_failure",
      "payload_rejected",
      "server_error",
      "invalid_json",
      "timeout",
      "created_but_response_lost",
      "duplicate_request",
      "rate_limited",
      "remote_assets_without_draft",
    ],
  );
});

test("MCP surface has no real execution, formal publish, or approval tool", () => {
  const names = TOOL_DEFINITIONS.map((definition) => definition.name);
  for (const forbidden of [
    "execute_real_draft",
    "approve_article",
    "formal_publish",
    "mass_send",
  ])
    assert.equal(names.includes(forbidden), false);
  assert.ok(names.includes("prepare_real_draft"));
  assert.ok(names.includes("request_human_draft_execution"));
});

async function bundleFiles(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await bundleFiles(absolute)));
    else if (/\.(?:js|css|html|map)$/i.test(entry.name)) output.push(absolute);
  }
  return output;
}

test("frontend bundle contains no scanner-detectable credential", async () => {
  const bundleRoot = path.join(root, "apps", "web", "dist");
  const files = await bundleFiles(bundleRoot);
  assert.ok(files.length > 0, "web build output is required for this scan");
  const findings = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const finding of scanText(source)) {
      findings.push({ file: path.relative(root, file), ...finding });
    }
  }
  assert.deepEqual(findings, []);
  assert.ok(scanText(`app_secret=${"Q".repeat(32)}`).length > 0);
});
