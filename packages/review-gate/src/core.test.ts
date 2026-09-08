import { describe, expect, it } from "vitest";
import {
  REVIEW_CHECKLIST_KEYS,
  ReviewGateError,
  createApprovalRecord,
  createInvalidationRecord,
  evaluateApprovalEligibility,
  evaluateApprovalValidity,
  isReviewChecklistComplete,
  markReviewedTransition,
  prepareReview,
  requestReviewTransition,
  verifyApprovalChain,
  verifyInvalidationChain,
} from "./index.js";
import {
  completeChecklist,
  validEvidence,
  validRequest,
} from "./test-fixtures.js";

describe("review transitions and checklist", () => {
  it("contains every required human review assertion", () => {
    expect(REVIEW_CHECKLIST_KEYS).toEqual([
      "content_read",
      "title_summary_confirmed",
      "facts_citations_checked",
      "image_sources_checked",
      "image_rights_checked",
      "mobile_preview_checked",
      "dark_mode_checked",
      "account_confirmed",
      "no_sensitive_information",
      "no_unfinished_placeholders",
    ]);
    expect(isReviewChecklistComplete(completeChecklist())).toBe(true);
    expect(
      isReviewChecklistComplete({
        ...completeChecklist(),
        mobile_preview_checked: false,
      }),
    ).toBe(false);
  });

  it("supports request-review and mark-reviewed without exposing approval", () => {
    expect(
      requestReviewTransition("draft", {
        actorType: "agent",
        actorId: "lint-agent",
      }),
    ).toEqual({
      ok: true,
      from: "draft",
      to: "reviewing",
    });
    expect(
      markReviewedTransition("reviewing", {
        actorType: "human",
        actorId: "reviewer",
      }),
    ).toEqual({
      ok: true,
      from: "reviewing",
      to: "reviewed",
    });
    expect(
      requestReviewTransition("idea", {
        actorType: "human",
        actorId: "reviewer",
      }).ok,
    ).toBe(false);
  });
});

describe("pure approval eligibility", () => {
  it("accepts only a fully current, explicitly human-confirmed request", () => {
    expect(prepareReview(validEvidence()).eligible).toBe(true);
    expect(evaluateApprovalEligibility(validRequest())).toEqual({
      eligible: true,
      blockers: [],
    });
  });

  it.each(["agent", "skill", "mcp", "ci", "automation", "github_action"])(
    "blocks %s from approving through the production decision",
    (actorType) => {
      const result = evaluateApprovalEligibility(
        validRequest({
          actor: {
            actorType,
            actorId: "automated-caller",
            explicitHumanAction: true,
          },
        }),
      );
      expect(result.eligible).toBe(false);
      expect(result.blockers.map((blocker) => blocker.code)).toContain(
        "ACTOR_NOT_HUMAN",
      );
      expect(() =>
        createApprovalRecord(
          validRequest({
            actor: {
              actorType,
              actorId: "automated-caller",
              explicitHumanAction: true,
            },
          }),
          {
            approvalId: "blocked",
            approvedAt: "2026-09-01T00:00:00.000Z",
            previousRecordHash: null,
          },
        ),
      ).toThrow(ReviewGateError);
    },
  );

  it("blocks pending rights, lint errors, stale build and stale preview hashes", () => {
    const evidence = validEvidence({
      lintErrorCount: 1,
      assets: [{ assetId: "cover", rightsStatus: "pending" }],
      buildSourceHash: "old-source",
      previewRenderedHtmlHash: "old-render",
    });
    const result = evaluateApprovalEligibility(validRequest({ evidence }));
    expect(result.blockers.map((blocker) => blocker.code)).toEqual(
      expect.arrayContaining([
        "LINT_ERRORS",
        "ASSET_RIGHTS_NOT_APPROVED",
        "BUILD_SOURCE_MISMATCH",
        "PREVIEW_RENDER_MISMATCH",
      ]),
    );
  });

  it("requires every checklist item and exact source hash confirmation", () => {
    const result = evaluateApprovalEligibility(
      validRequest({
        checklist: { ...completeChecklist(), facts_citations_checked: false },
        confirmedSourceHash: "source-v0",
      }),
    );
    expect(result.blockers.map((blocker) => blocker.code)).toEqual(
      expect.arrayContaining([
        "CHECKLIST_INCOMPLETE",
        "SOURCE_HASH_NOT_CONFIRMED",
      ]),
    );
  });
});

describe("tamper-evident binding and invalidation", () => {
  it("detects approval record and chain tampering", () => {
    const first = createApprovalRecord(validRequest(), {
      approvalId: "approval-1",
      approvedAt: "2026-09-01T00:00:00.000Z",
      previousRecordHash: null,
    });
    const second = createApprovalRecord(validRequest(), {
      approvalId: "approval-2",
      approvedAt: "2026-09-01T01:00:00.000Z",
      previousRecordHash: first.record_hash,
    });
    expect(verifyApprovalChain([first, second])).toEqual({
      valid: true,
      errors: [],
    });
    expect(
      verifyApprovalChain([{ ...first, source_hash: "tampered" }, second])
        .valid,
    ).toBe(false);
    expect(
      verifyApprovalChain([first, { ...second, previous_record_hash: null }])
        .valid,
    ).toBe(false);
  });

  it("invalidates an approval after source, asset, theme, renderer, linter or settings changes", () => {
    const approval = createApprovalRecord(validRequest(), {
      approvalId: "approval-1",
      approvedAt: "2026-09-01T00:00:00.000Z",
      previousRecordHash: null,
    });
    const current = validEvidence({
      status: "approved",
      sourceHash: "source-v2",
      assetsManifestHash: "assets-v2",
      themeHash: "theme-v2",
      rendererVersion: "renderer/3",
      linterVersion: "linter/3",
      buildSettingsHash: "build-settings-v2",
    });
    const validity = evaluateApprovalValidity(approval, current);
    expect(validity.valid).toBe(false);
    expect(validity.targetStatus).toBe("draft");
    expect(validity.reasons).toEqual(
      expect.arrayContaining([
        "source_changed",
        "assets_manifest_changed",
        "theme_changed",
        "renderer_version_changed",
        "linter_version_changed",
        "build_settings_changed",
      ]),
    );
    const invalidation = createInvalidationRecord({
      approval,
      current,
      actor: { actorType: "automation", actorId: "watcher" },
      invalidationId: "invalidation-1",
      invalidatedAt: "2026-09-01T02:00:00.000Z",
      previousRecordHash: null,
    });
    expect(verifyInvalidationChain([invalidation])).toEqual({
      valid: true,
      errors: [],
    });
    expect(
      verifyInvalidationChain([
        { ...invalidation, current_source_hash: "tampered" },
      ]).valid,
    ).toBe(false);
  });
});
