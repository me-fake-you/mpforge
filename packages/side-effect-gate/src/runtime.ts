import { SideEffectGateError } from "./errors.js";
import type {
  ExecutionContext,
  GateDecision,
  GateDependencies,
  WebHumanSession,
} from "./types.js";

const FORBIDDEN_SWITCHES = new Set([
  "--yes",
  "-y",
  "--force",
  "-f",
  "--skip-confirmation",
  "--non-interactive",
  "--approve",
  "--auto-approve",
]);

const AUTO_APPROVAL_ENV =
  /(^|_)(AUTO_APPROVE|AUTOMATIC_APPROVAL|FORCE_APPROVE|BYPASS_APPROVAL|SKIP_CONFIRMATION|APPROVE_WITHOUT_PROMPT|SIDE_EFFECT_APPROVED)$/i;
const APPROVAL_CODE_ENV = /(^|_)(CHALLENGE_CODE|CONFIRMATION_CODE)$/i;

const TRUE_VALUES = new Set(["1", "true", "yes", "on", "enabled"]);

function isEnabled(value: string | undefined): boolean {
  return value !== undefined && TRUE_VALUES.has(value.trim().toLowerCase());
}

function hasEnabledEnv(
  env: Readonly<Record<string, string | undefined>>,
  keys: readonly string[],
): boolean {
  return keys.some((key) => isEnabled(env[key]));
}

function throwForSurface(surface: ExecutionContext["surface"]): void {
  const codes = {
    mcp: ["MCP_BLOCKED", "MCP execution cannot perform a real side effect"],
    agent: [
      "AGENT_BLOCKED",
      "Agent execution cannot perform a real side effect",
    ],
    skill: [
      "SKILL_BLOCKED",
      "Skill execution cannot perform a real side effect",
    ],
    automation: [
      "AUTOMATION_BLOCKED",
      "Automation cannot perform a real side effect",
    ],
    background: [
      "BACKGROUND_BLOCKED",
      "Background execution cannot perform a real side effect",
    ],
    ci: ["CI_BLOCKED", "CI cannot perform a real side effect"],
    test: ["CI_BLOCKED", "Test execution cannot perform a real side effect"],
  } as const;

  if (surface in codes) {
    const [code, message] = codes[surface as keyof typeof codes];
    throw new SideEffectGateError(code, message);
  }
}

function rejectRuntimeSignals(
  env: Readonly<Record<string, string | undefined>>,
): void {
  if (
    isEnabled(env.MPFORGE_REAL_WECHAT_DISABLED) ||
    env.MPFORGE_NETWORK_MODE?.trim().toLowerCase() === "mock-only"
  ) {
    throw new SideEffectGateError(
      "REAL_EXECUTION_DISABLED",
      "The host environment explicitly disables real execution",
    );
  }
  if (isEnabled(env.GITHUB_ACTIONS)) {
    throw new SideEffectGateError(
      "GITHUB_ACTIONS_BLOCKED",
      "GitHub Actions cannot perform a real side effect",
    );
  }
  if (hasEnabledEnv(env, ["CI", "CONTINUOUS_INTEGRATION", "CODEX_CI"])) {
    throw new SideEffectGateError(
      "CI_BLOCKED",
      "CI cannot perform a real side effect",
    );
  }
  if (
    hasEnabledEnv(env, [
      "MPFORGE_MCP",
      "MCP_EXECUTION",
      "MCP_TOOL_CALL",
      "MCP_SERVER_EXECUTION",
    ])
  ) {
    throw new SideEffectGateError(
      "MCP_BLOCKED",
      "MCP execution cannot perform a real side effect",
    );
  }
  if (
    hasEnabledEnv(env, [
      "AI_AGENT_RUNTIME",
      "AGENT_RUNTIME",
      "MPFORGE_AGENT_RUNTIME",
      "CODEX_AGENT_RUNTIME",
    ]) ||
    Boolean(
      env.CODEX_THREAD_ID ||
        env.CODEX_SESSION_ID ||
        env.CODEX_AGENT_ID ||
        env.CODEX_APP_TOOLS_PIPE_PATH,
    )
  ) {
    throw new SideEffectGateError(
      "AGENT_BLOCKED",
      "Agent execution cannot perform a real side effect",
    );
  }
  if (
    hasEnabledEnv(env, [
      "MPFORGE_SKILL",
      "SKILL_RUNTIME",
      "CODEX_SKILL_RUNTIME",
    ])
  ) {
    throw new SideEffectGateError(
      "SKILL_BLOCKED",
      "Skill execution cannot perform a real side effect",
    );
  }
  if (
    hasEnabledEnv(env, [
      "MPFORGE_AUTOMATION",
      "AUTOMATION_RUNTIME",
      "CODEX_AUTOMATION",
    ])
  ) {
    throw new SideEffectGateError(
      "AUTOMATION_BLOCKED",
      "Automation cannot perform a real side effect",
    );
  }
  if (
    hasEnabledEnv(env, [
      "MPFORGE_BACKGROUND",
      "BACKGROUND_TASK",
      "BACKGROUND_RUNTIME",
    ])
  ) {
    throw new SideEffectGateError(
      "BACKGROUND_BLOCKED",
      "Background execution cannot perform a real side effect",
    );
  }

  const automaticApproval = Object.entries(env).find(
    ([key, value]) =>
      (AUTO_APPROVAL_ENV.test(key) && isEnabled(value)) ||
      (APPROVAL_CODE_ENV.test(key) && Boolean(value?.trim())),
  );
  if (automaticApproval) {
    throw new SideEffectGateError(
      "ENV_AUTO_APPROVAL_BLOCKED",
      `Environment-based approval is forbidden (${automaticApproval[0]})`,
    );
  }
}

function rejectBypassSwitches(argv: readonly string[]): void {
  const match = argv.find((argument) => {
    const switchName = argument.split("=", 1)[0]?.toLowerCase();
    return switchName !== undefined && FORBIDDEN_SWITCHES.has(switchName);
  });
  if (match) {
    throw new SideEffectGateError(
      "FORBIDDEN_BYPASS_FLAG",
      `Confirmation bypass switch is forbidden (${match})`,
    );
  }
}

function validateWebSessionShape(session: WebHumanSession, now: Date): void {
  if (
    session.actor !== "human" ||
    !session.session_id ||
    !session.server_attestation ||
    !session.csrf_verified ||
    !session.user_presence_verified
  ) {
    throw new SideEffectGateError(
      "WEB_HUMAN_SESSION_INVALID",
      "The Web session is not an attested human session",
    );
  }

  const issuedAt = Date.parse(session.issued_at);
  const expiresAt = Date.parse(session.expires_at);
  if (
    !Number.isFinite(issuedAt) ||
    !Number.isFinite(expiresAt) ||
    issuedAt > now.getTime()
  ) {
    throw new SideEffectGateError(
      "WEB_HUMAN_SESSION_INVALID",
      "The Web session time bounds are invalid",
    );
  }
  if (expiresAt <= now.getTime()) {
    throw new SideEffectGateError(
      "WEB_HUMAN_SESSION_EXPIRED",
      "The Web human session has expired",
    );
  }
}

/** Capture the real terminal process rather than trusting caller-supplied flags. */
export function captureCurrentCliExecutionContext(
  providerMode: ExecutionContext["provider_mode"],
): ExecutionContext {
  return {
    provider_mode: providerMode,
    surface: "cli",
    argv: process.argv.slice(2),
    env: process.env,
    stdin_is_tty: process.stdin.isTTY === true,
    stdout_is_tty: process.stdout.isTTY === true,
  };
}

export async function authorizeExecutionContext(
  context: Readonly<ExecutionContext>,
  dependencies: Readonly<GateDependencies> = {},
  now = new Date(),
): Promise<GateDecision> {
  if (context.provider_mode === "mock") {
    return {
      allowed: true,
      provider_mode: "mock",
      requires_human_challenge: false,
    };
  }

  throwForSurface(context.surface);
  rejectRuntimeSignals(process.env);
  rejectRuntimeSignals(context.env ?? {});
  rejectBypassSwitches(process.argv);
  rejectBypassSwitches(context.argv ?? []);

  if (context.surface === "cli") {
    if (!context.stdin_is_tty) {
      throw new SideEffectGateError(
        "PIPED_STDIN_BLOCKED",
        "Real execution requires direct TTY input; piped stdin is rejected",
      );
    }
    if (!context.stdout_is_tty) {
      throw new SideEffectGateError(
        "NON_INTERACTIVE_BLOCKED",
        "Real execution requires an interactive TTY",
      );
    }
  } else if (context.surface === "web") {
    const session = context.web_human_session;
    if (!session || !dependencies.verify_web_human_session) {
      throw new SideEffectGateError(
        "WEB_HUMAN_SESSION_REQUIRED",
        "Real Web execution requires a server-verified human session",
      );
    }
    validateWebSessionShape(session, now);
    if (!(await dependencies.verify_web_human_session(session))) {
      throw new SideEffectGateError(
        "WEB_HUMAN_SESSION_INVALID",
        "The Web human session attestation was rejected",
      );
    }
  } else {
    throw new SideEffectGateError(
      "REAL_CONTEXT_REQUIRED",
      "Real execution is limited to interactive CLI or controlled Web sessions",
    );
  }

  return {
    allowed: true,
    provider_mode: "real",
    requires_human_challenge: true,
  };
}
