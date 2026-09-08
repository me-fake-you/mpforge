import {
  ARTICLE_STATUSES,
  AUDIT_SCHEMA_ID,
  type ArticleStatus,
  type AuditEvent,
  type FrontmatterValue,
  type StatusRecommendation,
  type TransitionContext,
  type TransitionError,
  type TransitionResult,
} from "./types.js";

/** Round 1 production lifecycle. Publishing states exist in the schema but are closed. */
export const STATUS_TRANSITIONS: Readonly<
  Record<ArticleStatus, readonly ArticleStatus[]>
> = {
  idea: ["draft"],
  draft: ["reviewing"],
  reviewing: ["draft", "reviewed"],
  reviewed: ["draft", "approved"],
  // Approval revocation and evidence invalidation are explicit audited
  // transitions. Publishing remains closed until the next delivery round.
  approved: ["draft", "reviewed"],
  sent_to_draft: [],
  published: [],
  failed: [],
};

export function isArticleStatus(value: unknown): value is ArticleStatus {
  return (
    typeof value === "string" &&
    (ARTICLE_STATUSES as readonly string[]).includes(value)
  );
}

export function isAllowedTransition(
  from: ArticleStatus,
  to: ArticleStatus,
): boolean {
  return STATUS_TRANSITIONS[from].includes(to);
}

function makeId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `audit-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function getTransitionError(
  from: ArticleStatus,
  to: ArticleStatus,
  context: TransitionContext,
): TransitionError | undefined {
  if (!isAllowedTransition(from, to)) {
    if (to === "sent_to_draft") return "draft_submission_requires_approval";
    return "invalid_transition";
  }
  if (to === "approved" && context.actor.kind !== "human")
    return "approval_requires_human";
  if (context.actor.kind === "ai") return "ai_may_only_recommend";
  return undefined;
}

export function createStatusChangedEvent(
  from: ArticleStatus,
  to: ArticleStatus,
  context: TransitionContext,
): AuditEvent {
  return {
    schema: AUDIT_SCHEMA_ID,
    id: context.eventId || makeId(),
    timestamp: context.timestamp || new Date().toISOString(),
    actor: { ...context.actor },
    action: "status.changed",
    from_status: from,
    to_status: to,
    ...(context.reason ? { reason: context.reason } : {}),
    ...(context.articleHash ? { article_hash: context.articleHash } : {}),
    ...(context.details ? { details: { ...context.details } } : {}),
  };
}

/** Apply one status transition and create its audit event. */
export function transitionStatus(
  from: ArticleStatus,
  to: ArticleStatus,
  context: TransitionContext,
): TransitionResult {
  const error = getTransitionError(from, to, context);
  if (error) return { ok: false, from, to, error };
  return {
    ok: true,
    from,
    to,
    auditEvent: createStatusChangedEvent(from, to, context),
  };
}

/** AI recommendations are deliberately not transitions and therefore do not change article status. */
export function recommendStatusTransition(
  from: ArticleStatus,
  to: ArticleStatus,
  context: Omit<TransitionContext, "actor"> & {
    actor?: { kind?: "ai"; id?: string };
  },
): StatusRecommendation {
  if (from !== "draft" || to !== "reviewing") {
    throw new Error("AI may recommend only draft -> reviewing");
  }
  const actor = {
    kind: "ai" as const,
    ...(context.actor?.id ? { id: context.actor.id } : {}),
  };
  const event: AuditEvent = {
    schema: AUDIT_SCHEMA_ID,
    id: context.eventId || makeId(),
    timestamp: context.timestamp || new Date().toISOString(),
    actor,
    action: "review.recommended",
    from_status: from,
    to_status: to,
    ...(context.reason ? { reason: context.reason } : {}),
    ...(context.articleHash ? { article_hash: context.articleHash } : {}),
    ...(context.details ? { details: { ...context.details } } : {}),
  };
  return { from, to, actor, auditEvent: event };
}

export function replayStatus(
  initialStatus: ArticleStatus,
  events: readonly AuditEvent[],
): { status: ArticleStatus; valid: boolean; errors: string[] } {
  let status = initialStatus;
  const errors: string[] = [];
  for (const event of events) {
    if (event.action !== "status.changed") continue;
    if (!event.from_status || !event.to_status) {
      errors.push(`Status event ${event.id} has no from_status/to_status`);
      continue;
    }
    if (event.from_status !== status) {
      errors.push(
        `Status event ${event.id} starts at ${event.from_status}, expected ${status}`,
      );
      continue;
    }
    const error = getTransitionError(event.from_status, event.to_status, {
      actor: event.actor,
      // A persisted human approval event is itself the explicit action evidence.
      explicitHumanAction:
        event.to_status === "approved" && event.actor.kind === "human",
    });
    if (error) {
      errors.push(`Status event ${event.id} is invalid: ${error}`);
      continue;
    }
    status = event.to_status;
  }
  return { status, valid: errors.length === 0, errors };
}

// Keep this import-visible type assertion useful to callers constructing JSON details.
export type StatusDetails = Record<string, FrontmatterValue>;
