import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  FileChallengeStore,
  authorizeExecutionContext,
  consumeHumanSideEffectApproval,
  prepareHumanSideEffectApproval,
} from "./index.js";
import type {
  ApprovalBinding,
  ExecutionContext,
  GateDependencies,
  WebHumanSession,
} from "./index.js";

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const TEST_ROOT = resolve(PACKAGE_ROOT, ".test-tmp");
const PLAN_HASH = "a".repeat(64);
const NOW = new Date("2026-09-01T10:00:00.000Z");
const HOST_BLOCKER_KEYS = [
  "MPFORGE_REAL_WECHAT_DISABLED",
  "MPFORGE_NETWORK_MODE",
  "GITHUB_ACTIONS",
  "CI",
  "CONTINUOUS_INTEGRATION",
  "CODEX_CI",
  "MPFORGE_MCP",
  "MCP_EXECUTION",
  "MCP_TOOL_CALL",
  "MCP_SERVER_EXECUTION",
  "AI_AGENT_RUNTIME",
  "AGENT_RUNTIME",
  "MPFORGE_AGENT_RUNTIME",
  "CODEX_AGENT_RUNTIME",
  "CODEX_THREAD_ID",
  "CODEX_SESSION_ID",
  "CODEX_AGENT_ID",
  "CODEX_APP_TOOLS_PIPE_PATH",
  "MPFORGE_SKILL",
  "SKILL_RUNTIME",
  "CODEX_SKILL_RUNTIME",
  "MPFORGE_AUTOMATION",
  "AUTOMATION_RUNTIME",
  "CODEX_AUTOMATION",
  "MPFORGE_BACKGROUND",
  "BACKGROUND_TASK",
  "BACKGROUND_RUNTIME",
] as const;
const ORIGINAL_HOST_SIGNALS = new Map(
  HOST_BLOCKER_KEYS.map((key) => [key, process.env[key]]),
);

function binding(overrides: Partial<ApprovalBinding> = {}): ApprovalBinding {
  return {
    operation_id: "op-round3-001",
    account_alias: "personal-example",
    plan_hash: PLAN_HASH,
    ...overrides,
  };
}

function realCli(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    provider_mode: "real",
    surface: "cli",
    argv: [],
    env: {},
    stdin_is_tty: true,
    stdout_is_tty: true,
    ...overrides,
  };
}

function webSession(overrides: Partial<WebHumanSession> = {}): WebHumanSession {
  return {
    session_id: "human-session-1",
    actor: "human",
    issued_at: "2026-09-01T09:59:00.000Z",
    expires_at: "2026-09-01T10:05:00.000Z",
    csrf_verified: true,
    user_presence_verified: true,
    server_attestation: "opaque-server-attestation",
    ...overrides,
  };
}

const verifiedWeb: GateDependencies = {
  verify_web_human_session: (session) =>
    session.server_attestation === "opaque-server-attestation",
};

function realWeb(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    provider_mode: "real",
    surface: "web",
    argv: [],
    env: {},
    web_human_session: webSession(),
    ...overrides,
  };
}

beforeEach(() => {
  for (const key of HOST_BLOCKER_KEYS) {
    delete process.env[key];
  }
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

afterAll(() => {
  for (const [key, value] of ORIGINAL_HOST_SIGNALS) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

describe("execution context gate", () => {
  it.each(["cli", "web", "mcp", "test", "ci"] as const)(
    "allows mock execution from %s",
    async (surface) => {
      await expect(
        authorizeExecutionContext({
          provider_mode: "mock",
          surface,
          env: { CI: "true", GITHUB_ACTIONS: "true" },
          argv: ["--force"],
          stdin_is_tty: false,
          stdout_is_tty: false,
        }),
      ).resolves.toEqual({
        allowed: true,
        provider_mode: "mock",
        requires_human_challenge: false,
      });
    },
  );

  it.each([
    ["mcp", "MCP_BLOCKED"],
    ["agent", "AGENT_BLOCKED"],
    ["skill", "SKILL_BLOCKED"],
    ["automation", "AUTOMATION_BLOCKED"],
    ["background", "BACKGROUND_BLOCKED"],
    ["ci", "CI_BLOCKED"],
    ["test", "CI_BLOCKED"],
  ] as const)("rejects real execution from %s", async (surface, code) => {
    await expect(
      authorizeExecutionContext({ provider_mode: "real", surface }),
    ).rejects.toMatchObject({ code });
  });

  it.each([
    [{ MPFORGE_REAL_WECHAT_DISABLED: "true" }, "REAL_EXECUTION_DISABLED"],
    [{ MPFORGE_NETWORK_MODE: "mock-only" }, "REAL_EXECUTION_DISABLED"],
    [{ GITHUB_ACTIONS: "true" }, "GITHUB_ACTIONS_BLOCKED"],
    [{ CI: "1" }, "CI_BLOCKED"],
    [{ MPFORGE_MCP: "yes" }, "MCP_BLOCKED"],
    [{ CODEX_THREAD_ID: "thread-1" }, "AGENT_BLOCKED"],
    [{ SKILL_RUNTIME: "enabled" }, "SKILL_BLOCKED"],
    [{ AUTOMATION_RUNTIME: "on" }, "AUTOMATION_BLOCKED"],
    [{ BACKGROUND_TASK: "true" }, "BACKGROUND_BLOCKED"],
    [{ MPFORGE_AUTO_APPROVE: "true" }, "ENV_AUTO_APPROVAL_BLOCKED"],
    [{ MPFORGE_CHALLENGE_CODE: "12345678" }, "ENV_AUTO_APPROVAL_BLOCKED"],
  ] as const)("rejects hostile runtime signal %j", async (env, code) => {
    await expect(
      authorizeExecutionContext(realCli({ env })),
    ).rejects.toMatchObject({ code });
  });

  it.each([
    "--yes",
    "-y",
    "--force",
    "-f",
    "--skip-confirmation",
    "--non-interactive",
    "--approve",
    "--auto-approve=true",
  ])("rejects confirmation bypass switch %s", async (flag) => {
    await expect(
      authorizeExecutionContext(realCli({ argv: [flag] })),
    ).rejects.toMatchObject({ code: "FORBIDDEN_BYPASS_FLAG" });
  });

  it("rejects piped stdin", async () => {
    await expect(
      authorizeExecutionContext(realCli({ stdin_is_tty: false })),
    ).rejects.toMatchObject({ code: "PIPED_STDIN_BLOCKED" });
  });

  it("rejects a non-interactive terminal", async () => {
    await expect(
      authorizeExecutionContext(realCli({ stdout_is_tty: false })),
    ).rejects.toMatchObject({ code: "NON_INTERACTIVE_BLOCKED" });
  });

  it("allows an interactive terminal but still requires a challenge", async () => {
    await expect(authorizeExecutionContext(realCli())).resolves.toEqual({
      allowed: true,
      provider_mode: "real",
      requires_human_challenge: true,
    });
  });

  it("reads agent signals from the host process even when context env is empty", async () => {
    process.env.CODEX_THREAD_ID = "host-agent-thread";
    await expect(
      authorizeExecutionContext(realCli({ env: {} })),
    ).rejects.toMatchObject({ code: "AGENT_BLOCKED" });
  });

  it("reads bypass switches from the host process argv", async () => {
    process.argv.push("--skip-confirmation");
    try {
      await expect(
        authorizeExecutionContext(realCli({ argv: [] })),
      ).rejects.toMatchObject({ code: "FORBIDDEN_BYPASS_FLAG" });
    } finally {
      process.argv.pop();
    }
  });

  it("requires a server verifier for Web human sessions", async () => {
    await expect(
      authorizeExecutionContext(realWeb(), {}, NOW),
    ).rejects.toMatchObject({
      code: "WEB_HUMAN_SESSION_REQUIRED",
    });
  });

  it("rejects agent actors even with a Web-shaped session", async () => {
    await expect(
      authorizeExecutionContext(
        realWeb({ web_human_session: webSession({ actor: "agent" }) }),
        verifiedWeb,
        NOW,
      ),
    ).rejects.toMatchObject({ code: "WEB_HUMAN_SESSION_INVALID" });
  });

  it("rejects expired Web human sessions", async () => {
    await expect(
      authorizeExecutionContext(
        realWeb({
          web_human_session: webSession({
            expires_at: "2026-09-01T09:59:59.000Z",
          }),
        }),
        verifiedWeb,
        NOW,
      ),
    ).rejects.toMatchObject({ code: "WEB_HUMAN_SESSION_EXPIRED" });
  });

  it("rejects a failed server attestation", async () => {
    await expect(
      authorizeExecutionContext(
        realWeb({
          web_human_session: webSession({ server_attestation: "tampered" }),
        }),
        verifiedWeb,
        NOW,
      ),
    ).rejects.toMatchObject({ code: "WEB_HUMAN_SESSION_INVALID" });
  });

  it("accepts a controlled Web human session", async () => {
    await expect(
      authorizeExecutionContext(realWeb(), verifiedWeb, NOW),
    ).resolves.toMatchObject({
      allowed: true,
      provider_mode: "real",
      requires_human_challenge: true,
    });
  });
});

describe("one-time human challenge", () => {
  it("persists only a hash and challenge timestamps", async () => {
    const store = new FileChallengeStore(TEST_ROOT);
    const issued = await prepareHumanSideEffectApproval(
      { binding: binding(), context: realCli(), now: NOW },
      store,
    );
    const raw = readFileSync(store.recordPath(binding()), "utf8");
    const persisted = JSON.parse(raw) as Record<string, unknown>;

    expect(Object.keys(persisted).sort()).toEqual([
      "code_hash",
      "consumed_at",
      "created_at",
      "expires_at",
    ]);
    expect(raw).not.toContain(issued.challenge_code);
    expect(persisted.code_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("consumes a correctly bound code exactly once", async () => {
    const store = new FileChallengeStore(TEST_ROOT);
    const issued = await prepareHumanSideEffectApproval(
      { binding: binding(), context: realCli(), now: NOW },
      store,
    );
    const request = {
      binding: binding(),
      context: realCli(),
      challenge_code: issued.challenge_code,
      submitted_by: "human-tty" as const,
      now: new Date("2026-09-01T10:01:00.000Z"),
    };

    await expect(
      consumeHumanSideEffectApproval(request, store),
    ).resolves.toMatchObject({
      operation_id: "op-round3-001",
      account_alias: "personal-example",
      plan_hash: PLAN_HASH,
    });
    await expect(
      consumeHumanSideEffectApproval(request, store),
    ).rejects.toMatchObject({ code: "CHALLENGE_ALREADY_CONSUMED" });
  });

  it("rejects an expired code", async () => {
    const store = new FileChallengeStore(TEST_ROOT);
    const issued = await prepareHumanSideEffectApproval(
      { binding: binding(), context: realCli(), now: NOW, ttl_seconds: 30 },
      store,
    );
    await expect(
      consumeHumanSideEffectApproval(
        {
          binding: binding(),
          context: realCli(),
          challenge_code: issued.challenge_code,
          submitted_by: "human-tty",
          now: new Date("2026-09-01T10:00:30.000Z"),
        },
        store,
      ),
    ).rejects.toMatchObject({ code: "CHALLENGE_EXPIRED" });
  });

  it.each([
    binding({ account_alias: "changed-account" }),
    binding({ plan_hash: "b".repeat(64) }),
    binding({ operation_id: "changed-operation" }),
  ])("rejects changed binding %j", async (changedBinding) => {
    const store = new FileChallengeStore(TEST_ROOT);
    const issued = await prepareHumanSideEffectApproval(
      { binding: binding(), context: realCli(), now: NOW },
      store,
    );
    await expect(
      consumeHumanSideEffectApproval(
        {
          binding: changedBinding,
          context: realCli(),
          challenge_code: issued.challenge_code,
          submitted_by: "human-tty",
          now: new Date("2026-09-01T10:01:00.000Z"),
        },
        store,
      ),
    ).rejects.toMatchObject({ code: "CHALLENGE_NOT_FOUND" });
  });

  it("rejects an incorrect code", async () => {
    const store = new FileChallengeStore(TEST_ROOT);
    await prepareHumanSideEffectApproval(
      { binding: binding(), context: realCli(), now: NOW },
      store,
    );
    await expect(
      consumeHumanSideEffectApproval(
        {
          binding: binding(),
          context: realCli(),
          challenge_code: "00000000",
          submitted_by: "human-tty",
          now: new Date("2026-09-01T10:01:00.000Z"),
        },
        store,
      ),
    ).rejects.toMatchObject({ code: "CHALLENGE_INVALID" });
  });

  it("does not issue a human challenge for mock mode", async () => {
    const store = new FileChallengeStore(TEST_ROOT);
    await expect(
      prepareHumanSideEffectApproval(
        {
          binding: binding(),
          context: { provider_mode: "mock", surface: "mcp" },
          now: NOW,
        },
        store,
      ),
    ).rejects.toMatchObject({ code: "REAL_CONTEXT_REQUIRED" });
  });

  it("does not let MCP submit a human challenge code", async () => {
    const store = new FileChallengeStore(TEST_ROOT);
    const issued = await prepareHumanSideEffectApproval(
      { binding: binding(), context: realCli(), now: NOW },
      store,
    );
    await expect(
      consumeHumanSideEffectApproval(
        {
          binding: binding(),
          context: { provider_mode: "real", surface: "mcp" },
          challenge_code: issued.challenge_code,
          submitted_by: "human-tty",
          now: new Date("2026-09-01T10:01:00.000Z"),
        },
        store,
      ),
    ).rejects.toMatchObject({ code: "MCP_BLOCKED" });
  });

  it("does not let an agent submit through a Web form", async () => {
    const store = new FileChallengeStore(TEST_ROOT);
    const issued = await prepareHumanSideEffectApproval(
      { binding: binding(), context: realCli(), now: NOW },
      store,
    );
    await expect(
      consumeHumanSideEffectApproval(
        {
          binding: binding(),
          context: realWeb({
            web_human_session: webSession({ actor: "agent" }),
          }),
          challenge_code: issued.challenge_code,
          submitted_by: "human-web-form",
          now: new Date("2026-09-01T10:01:00.000Z"),
        },
        store,
        verifiedWeb,
      ),
    ).rejects.toMatchObject({ code: "WEB_HUMAN_SESSION_INVALID" });
  });

  it("requires submitter type to match the verified surface", async () => {
    const store = new FileChallengeStore(TEST_ROOT);
    const issued = await prepareHumanSideEffectApproval(
      { binding: binding(), context: realCli(), now: NOW },
      store,
    );
    await expect(
      consumeHumanSideEffectApproval(
        {
          binding: binding(),
          context: realCli(),
          challenge_code: issued.challenge_code,
          submitted_by: "human-web-form",
          now: new Date("2026-09-01T10:01:00.000Z"),
        },
        store,
      ),
    ).rejects.toMatchObject({ code: "CHALLENGE_SUBMITTER_MISMATCH" });
  });

  it("supports a verified Web human request and consume path", async () => {
    const store = new FileChallengeStore(TEST_ROOT);
    const issued = await prepareHumanSideEffectApproval(
      { binding: binding(), context: realWeb(), now: NOW },
      store,
      verifiedWeb,
    );
    await expect(
      consumeHumanSideEffectApproval(
        {
          binding: binding(),
          context: realWeb(),
          challenge_code: issued.challenge_code,
          submitted_by: "human-web-form",
          now: new Date("2026-09-01T10:01:00.000Z"),
        },
        store,
        verifiedWeb,
      ),
    ).resolves.toMatchObject({ consumed_at: "2026-09-01T10:01:00.000Z" });
  });
});
