import {
  parseArticleDocument,
  parseStateEvents,
  serializeArticleDocument,
  serializeStateEvents,
  validateStateEventChain,
  type StateEvent,
} from "@mpforge/content-schema";
import { sha256 } from "@mpforge/renderer";
import {
  createInvalidationRecord,
  verifyApprovalChain,
  verifyInvalidationChain,
  type ApprovalInvalidationRecord,
  type ApprovalRecord,
  type ReviewEvidence,
} from "@mpforge/review-gate";

export interface ApprovalInvalidationTextStore {
  read(path: string): Promise<string | null>;
  write(path: string, content: string, expectedContent: string): Promise<void>;
}

function joinSibling(articlePath: string, relative: string): string {
  const separator = articlePath.includes("\\") ? "\\" : "/";
  const directory = articlePath.replace(/[\\/]article\.md$/i, "");
  return `${directory}${separator}${relative.replaceAll("/", separator)}`;
}

function parseJsonLines<T>(raw: string): T[] {
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

function appendJsonLine(raw: string, value: unknown): string {
  const prefix = raw && !raw.endsWith("\n") ? `${raw}\n` : raw;
  return `${prefix}${JSON.stringify(value)}\n`;
}

export function approvalSourceHash(source: string): string {
  return sha256(
    source.replace(
      /^(status|human_reviewed|updated_at|version):[^\r\n]*$/gm,
      "$1: <workflow-managed>",
    ),
  );
}

function evidenceAfterSourceChange(
  approval: ApprovalRecord,
  sourceHash: string,
): ReviewEvidence {
  return {
    articleId: approval.article_id,
    // The invalidation is evaluated immediately before the audited status
    // transition, so source_changed remains the primary causal reason.
    status: "approved",
    sourceHash,
    renderedHtmlHash: approval.rendered_html_hash,
    wechatHtmlHash: approval.wechat_html_hash,
    lintReportHash: approval.lint_report_hash,
    assetsManifestHash: approval.assets_manifest_hash,
    themeHash: approval.theme_hash,
    rendererVersion: approval.renderer_version,
    linterVersion: approval.linter_version,
    rulesetVersion: approval.ruleset_version,
    buildSettingsHash: approval.build_settings_hash,
    publishSettingsHash: approval.publish_settings_hash,
    lintErrorCount: 0,
    assets: [],
    artifacts: {
      rawHtml: true,
      safeHtml: true,
      wechatHtml: true,
      lintReport: true,
      assetsManifest: true,
      previewReport: true,
    },
    buildSourceHash: approval.source_hash,
    lintSourceHash: approval.source_hash,
    lintRenderedHtmlHash: approval.rendered_html_hash,
    previewSourceHash: approval.source_hash,
    previewRenderedHtmlHash: approval.rendered_html_hash,
    previewWechatHtmlHash: approval.wechat_html_hash,
  };
}

/**
 * Invalidates the latest approval before an approved source is overwritten.
 * Audit writes happen first so a partial storage failure always fails closed.
 */
export async function invalidateApprovedSourceMutation(input: {
  articlePath: string;
  previousSource: string;
  proposedSource: string;
  store: ApprovalInvalidationTextStore;
  actorId?: string;
  now?: string;
}): Promise<{
  content: string;
  invalidated: boolean;
  invalidationRecord: ApprovalInvalidationRecord | null;
}> {
  if (input.previousSource === input.proposedSource) {
    return {
      content: input.proposedSource,
      invalidated: false,
      invalidationRecord: null,
    };
  }
  const previous = parseArticleDocument(input.previousSource);
  if (previous.frontmatter.status !== "approved") {
    return {
      content: input.proposedSource,
      invalidated: false,
      invalidationRecord: null,
    };
  }

  const proposed = parseArticleDocument(input.proposedSource);
  const now = input.now ?? new Date().toISOString();
  const content = serializeArticleDocument({
    ...proposed,
    frontmatter: {
      ...proposed.frontmatter,
      status: "draft",
      human_reviewed: false,
      updated_at: now,
      version:
        typeof previous.frontmatter.version === "number"
          ? previous.frontmatter.version + 1
          : 1,
    },
  });

  const approvalsPath = joinSibling(
    input.articlePath,
    "history/approvals.jsonl",
  );
  const invalidationsPath = joinSibling(
    input.articlePath,
    "history/approval-invalidations.jsonl",
  );
  const stateEventsPath = joinSibling(
    input.articlePath,
    "history/state-events.jsonl",
  );
  const [approvalRaw, invalidationRaw, stateRaw] = await Promise.all([
    input.store.read(approvalsPath).then((value) => value ?? ""),
    input.store.read(invalidationsPath).then((value) => value ?? ""),
    input.store.read(stateEventsPath).then((value) => value ?? ""),
  ]);
  const approvals = parseJsonLines<ApprovalRecord>(approvalRaw);
  const invalidations =
    parseJsonLines<ApprovalInvalidationRecord>(invalidationRaw);
  const approvalChain = verifyApprovalChain(approvals);
  const invalidationChain = verifyInvalidationChain(invalidations);
  if (!approvalChain.valid || !invalidationChain.valid) {
    throw new Error("APPROVAL_AUDIT_CHAIN_INVALID: source mutation blocked");
  }
  const alreadyInvalidated = new Set(
    invalidations.map((record) => record.previous_approval_id),
  );
  const approval = [...approvals]
    .reverse()
    .find((record) => !alreadyInvalidated.has(record.approval_id));
  if (!approval) {
    throw new Error("ACTIVE_APPROVAL_MISSING: source mutation blocked");
  }
  const parsedState = parseStateEvents(stateRaw);
  const stateChain = validateStateEventChain(parsedState.events);
  if (
    parsedState.errors.length > 0 ||
    !stateChain.valid ||
    stateChain.status !== "approved"
  ) {
    throw new Error("STATE_AUDIT_CHAIN_INVALID: source mutation blocked");
  }

  const record = createInvalidationRecord({
    approval,
    current: evidenceAfterSourceChange(approval, approvalSourceHash(content)),
    actor: {
      actorType: "automation",
      actorId: input.actorId ?? "web-local-autosave",
    },
    invalidationId: crypto.randomUUID(),
    invalidatedAt: now,
    previousRecordHash: invalidations.at(-1)?.record_hash ?? null,
  });
  const stateEvent: StateEvent = {
    event_id: crypto.randomUUID(),
    article_id: approval.article_id,
    from_status: "approved",
    to_status: "draft",
    actor_type: "automation",
    actor_id: input.actorId ?? "web-local-autosave",
    reason: `Approval ${approval.approval_id} invalidated after source change`,
    created_at: now,
    source_commit: "working-tree",
  };
  await input.store.write(
    invalidationsPath,
    appendJsonLine(invalidationRaw, record),
    invalidationRaw,
  );
  await input.store.write(
    stateEventsPath,
    serializeStateEvents([...parsedState.events, stateEvent]),
    stateRaw,
  );
  return { content, invalidated: true, invalidationRecord: record };
}
