export type ProviderMode = "mock" | "real";

export type ExecutionSurface =
  | "cli"
  | "web"
  | "mcp"
  | "test"
  | "ci"
  | "agent"
  | "skill"
  | "automation"
  | "background";

export type HumanActor = "human" | "agent" | "mcp" | "automation";

/**
 * An opaque, server-issued Web session assertion. The gate never accepts a
 * browser's claim by itself; the hosting server must verify the assertion.
 */
export interface WebHumanSession {
  session_id: string;
  actor: HumanActor;
  issued_at: string;
  expires_at: string;
  csrf_verified: boolean;
  user_presence_verified: boolean;
  server_attestation: string;
}

export interface ExecutionContext {
  provider_mode: ProviderMode;
  surface: ExecutionSurface;
  argv?: readonly string[];
  env?: Readonly<Record<string, string | undefined>>;
  stdin_is_tty?: boolean;
  stdout_is_tty?: boolean;
  web_human_session?: WebHumanSession;
}

export interface ApprovalBinding {
  operation_id: string;
  account_alias: string;
  plan_hash: string;
}

export interface PersistedChallengeRecord {
  code_hash: string;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
}

export interface HumanSessionApprovalRequest {
  binding: ApprovalBinding;
  context: ExecutionContext;
  ttl_seconds?: number;
  now?: Date;
}

export interface HumanSessionApprovalConsume {
  binding: ApprovalBinding;
  context: ExecutionContext;
  challenge_code: string;
  submitted_by: "human-tty" | "human-web-form";
  now?: Date;
}

export interface HumanChallengeDisplay {
  /** Render directly to the verified human. Never log or persist this value. */
  challenge_code: string;
  operation_id: string;
  account_alias: string;
  plan_hash: string;
  expires_at: string;
}

export interface HumanApprovalConsumed {
  operation_id: string;
  account_alias: string;
  plan_hash: string;
  consumed_at: string;
}

export type WebHumanSessionVerifier = (
  session: Readonly<WebHumanSession>,
) => boolean | Promise<boolean>;

export interface GateDependencies {
  verify_web_human_session?: WebHumanSessionVerifier;
}

export interface GateDecision {
  allowed: true;
  provider_mode: ProviderMode;
  requires_human_challenge: boolean;
}
