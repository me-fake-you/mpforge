import { describe, expect, it } from "vitest";
import {
  buildArticleDocument,
  serializeStateEvents,
  type StateEvent,
} from "@mpforge/content-schema";
import {
  REVIEW_CHECKLIST_KEYS,
  createApprovalRecord,
  type ReviewEvidence,
} from "@mpforge/review-gate";
import {
  approvalSourceHash,
  invalidateApprovedSourceMutation,
} from "../../services/approvalInvalidation";

const articlePath = "content/approved/article.md";

function article(body: string): string {
  return buildArticleDocument(
    {
      id: "approved",
      title: "Approved fixture",
      summary: "Approval invalidation fixture.",
      author: "MPForge QA",
      account: "qa-account",
      theme: "minimal",
      status: "approved",
      original: true,
      ai_assisted: false,
      ai_tasks: [],
      human_reviewed: true,
      need_open_comment: false,
      only_fans_can_comment: false,
      created_at: "2026-09-01T00:00:00.000Z",
      updated_at: "2026-09-01T00:00:00.000Z",
      version: 4,
    },
    body,
  );
}

describe("approved source invalidation", () => {
  it("appends tamper-evident invalidation/state records and returns to draft", async () => {
    const previous = article("# Verified\n\nBefore.\n");
    const sourceHash = approvalSourceHash(previous);
    const evidence: ReviewEvidence = {
      articleId: "approved",
      status: "reviewed",
      sourceHash,
      renderedHtmlHash: "render-hash",
      wechatHtmlHash: "wechat-hash",
      lintReportHash: "lint-hash",
      assetsManifestHash: "assets-hash",
      themeHash: "theme-hash",
      rendererVersion: "renderer-v1",
      linterVersion: "linter-v1",
      rulesetVersion: "rules-v1",
      buildSettingsHash: "build-settings-hash",
      publishSettingsHash: "publish-settings-hash",
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
      buildSourceHash: sourceHash,
      lintSourceHash: sourceHash,
      lintRenderedHtmlHash: "render-hash",
      previewSourceHash: sourceHash,
      previewRenderedHtmlHash: "render-hash",
      previewWechatHtmlHash: "wechat-hash",
    };
    const checklist = Object.fromEntries(
      REVIEW_CHECKLIST_KEYS.map((key) => [key, true]),
    ) as Record<(typeof REVIEW_CHECKLIST_KEYS)[number], boolean>;
    const approval = createApprovalRecord(
      {
        evidence,
        checklist,
        actor: {
          actorType: "human",
          actorId: "qa-reviewer",
          explicitHumanAction: true,
        },
        confirmedSourceHash: sourceHash,
        warningsAcknowledged: [],
        sourceCommit: "test-commit",
      },
      {
        approvalId: "approval-1",
        approvedAt: "2026-09-01T00:01:00.000Z",
        previousRecordHash: null,
      },
    );
    const transitions: Array<[string, string]> = [
      ["idea", "draft"],
      ["draft", "reviewing"],
      ["reviewing", "reviewed"],
      ["reviewed", "approved"],
    ];
    const stateEvents = transitions.map(
      ([from, to], index): StateEvent => ({
        event_id: `event-${index}`,
        article_id: "approved",
        from_status: from as StateEvent["from_status"],
        to_status: to as StateEvent["to_status"],
        actor_type: "human",
        actor_id: "qa-reviewer",
        reason: "Fixture transition",
        created_at: `2026-09-01T00:0${index}:00.000Z`,
        source_commit: "test-commit",
      }),
    );
    const files = new Map<string, string>([
      [
        "content/approved/history/approvals.jsonl",
        `${JSON.stringify(approval)}\n`,
      ],
      ["content/approved/history/approval-invalidations.jsonl", ""],
      [
        "content/approved/history/state-events.jsonl",
        serializeStateEvents(stateEvents),
      ],
    ]);
    const result = await invalidateApprovedSourceMutation({
      articlePath,
      previousSource: previous,
      proposedSource: article("# Verified\n\nAfter.\n"),
      now: "2026-09-01T00:10:00.000Z",
      store: {
        read: async (path) => files.get(path) ?? null,
        write: async (path, content, expected) => {
          expect(files.get(path) ?? "").toBe(expected);
          files.set(path, content);
        },
      },
    });

    expect(result.invalidated).toBe(true);
    expect(result.content).toContain('status: "draft"');
    expect(result.content).toContain("human_reviewed: false");
    const invalidation = JSON.parse(
      files
        .get("content/approved/history/approval-invalidations.jsonl")!
        .trim(),
    ) as { reason: string; previous_approval_id: string; record_hash: string };
    expect(invalidation).toMatchObject({
      reason: "source_changed",
      previous_approval_id: "approval-1",
    });
    expect(invalidation.record_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(files.get("content/approved/history/state-events.jsonl")).toContain(
      '"from_status":"approved","to_status":"draft"',
    );
  });
});
