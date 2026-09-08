import {
  AUDIT_SCHEMA_ID,
  type AuditEvent,
  type AuditParseResult,
  type ArticleStatus,
  type StateEvent,
} from "./types.js";
import { replayStatus } from "./statusMachine.js";
import { getTransitionError, isArticleStatus } from "./statusMachine.js";

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isAuditEvent(value: unknown): value is AuditEvent {
  if (!isObject(value)) return false;
  return (
    value.schema === AUDIT_SCHEMA_ID &&
    typeof value.id === "string" &&
    typeof value.timestamp === "string" &&
    isObject(value.actor) &&
    (value.actor.kind === "human" ||
      value.actor.kind === "ai" ||
      value.actor.kind === "automation" ||
      value.actor.kind === "system") &&
    typeof value.action === "string"
  );
}

function isStateEvent(value: unknown): value is StateEvent {
  if (!isObject(value)) return false;
  return (
    typeof value.event_id === "string" &&
    typeof value.article_id === "string" &&
    isArticleStatus(value.from_status) &&
    isArticleStatus(value.to_status) &&
    (value.actor_type === "human" ||
      value.actor_type === "ai" ||
      value.actor_type === "automation" ||
      value.actor_type === "system") &&
    typeof value.actor_id === "string" &&
    Boolean(value.actor_id.trim()) &&
    typeof value.reason === "string" &&
    Boolean(value.reason.trim()) &&
    typeof value.created_at === "string" &&
    !Number.isNaN(Date.parse(value.created_at)) &&
    typeof value.source_commit === "string" &&
    Boolean(value.source_commit.trim())
  );
}

export function serializeStateEvents(events: readonly StateEvent[]): string {
  return events.length
    ? `${events.map((event) => JSON.stringify(event)).join("\n")}\n`
    : "";
}

export function parseStateEvents(raw: string): {
  events: StateEvent[];
  errors: string[];
} {
  const events: StateEvent[] = [];
  const errors: string[] = [];
  raw.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    try {
      const value: unknown = JSON.parse(line);
      if (!isStateEvent(value)) throw new Error("Invalid state event shape");
      events.push(value);
    } catch (error) {
      errors.push(
        `State event line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
  return { events, errors };
}

export function validateStateEventChain(
  events: readonly StateEvent[],
  initialStatus: ArticleStatus = "idea",
): { valid: boolean; status: ArticleStatus; errors: string[] } {
  let status = initialStatus;
  const errors: string[] = [];
  let articleId: string | undefined;
  const eventIds = new Set<string>();
  for (const event of events) {
    if (eventIds.has(event.event_id))
      errors.push(`Duplicate state event id: ${event.event_id}`);
    eventIds.add(event.event_id);
    articleId ??= event.article_id;
    if (event.article_id !== articleId)
      errors.push(`State event ${event.event_id} changes article_id`);
    if (event.from_status !== status) {
      errors.push(
        `State event ${event.event_id} starts at ${event.from_status}, expected ${status}`,
      );
      continue;
    }
    const error = getTransitionError(event.from_status, event.to_status, {
      actor: { kind: event.actor_type, id: event.actor_id },
      explicitHumanAction:
        event.to_status === "approved" && event.actor_type === "human",
    });
    if (error) {
      errors.push(`State event ${event.event_id} is invalid: ${error}`);
      continue;
    }
    status = event.to_status;
  }
  return { valid: errors.length === 0, status, errors };
}

/** JSONL is deliberately used so audit entries remain inspectable and diffable in Git. */
export function serializeAudit(events: readonly AuditEvent[]): string {
  if (events.length === 0) return "";
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

export function parseAudit(raw: string): AuditParseResult {
  const events: AuditEvent[] = [];
  const errors: string[] = [];
  raw.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    try {
      const value: unknown = JSON.parse(line);
      if (!isAuditEvent(value)) throw new Error("Invalid audit event shape");
      events.push(value);
    } catch (error) {
      errors.push(
        `Audit line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
  return { events, errors };
}

export function appendAudit(raw: string, event: AuditEvent): string {
  const prefix = raw && !raw.endsWith("\n") ? `${raw}\n` : raw;
  return `${prefix}${JSON.stringify(event)}\n`;
}

export function replayAudit(
  initialStatus: ArticleStatus,
  rawOrEvents: string | readonly AuditEvent[],
): ReturnType<typeof replayStatus> & { events: AuditEvent[] } {
  const parsed =
    typeof rawOrEvents === "string"
      ? parseAudit(rawOrEvents)
      : { events: [...rawOrEvents], errors: [] };
  const replay = replayStatus(initialStatus, parsed.events);
  return {
    ...replay,
    events: parsed.events,
    errors: [...parsed.errors, ...replay.errors],
    valid: parsed.errors.length === 0 && replay.valid,
  };
}
