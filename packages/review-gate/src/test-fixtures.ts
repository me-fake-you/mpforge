import {
  REVIEW_CHECKLIST_KEYS,
  type ApprovalRequest,
  type ReviewChecklist,
  type ReviewEvidence,
} from "./index.js";

export const completeChecklist = (): ReviewChecklist =>
  Object.fromEntries(
    REVIEW_CHECKLIST_KEYS.map((key) => [key, true]),
  ) as unknown as ReviewChecklist;

export const validEvidence = (
  overrides: Partial<ReviewEvidence> = {},
): ReviewEvidence => ({
  articleId: "article-1",
  status: "reviewed",
  sourceHash: "source-v1",
  renderedHtmlHash: "render-v1",
  wechatHtmlHash: "wechat-v1",
  lintReportHash: "lint-v1",
  assetsManifestHash: "assets-v1",
  themeHash: "theme-v1",
  rendererVersion: "renderer/2",
  linterVersion: "linter/2",
  rulesetVersion: "wechat/2026-09",
  buildSettingsHash: "build-settings-v1",
  publishSettingsHash: "publish-settings-v1",
  lintErrorCount: 0,
  assets: [{ assetId: "cover", rightsStatus: "approved" }],
  artifacts: {
    rawHtml: true,
    safeHtml: true,
    wechatHtml: true,
    lintReport: true,
    assetsManifest: true,
    previewReport: true,
  },
  buildSourceHash: "source-v1",
  lintSourceHash: "source-v1",
  lintRenderedHtmlHash: "render-v1",
  previewSourceHash: "source-v1",
  previewRenderedHtmlHash: "render-v1",
  previewWechatHtmlHash: "wechat-v1",
  ...overrides,
});

export const validRequest = (
  overrides: Partial<ApprovalRequest> = {},
): ApprovalRequest => ({
  evidence: validEvidence(),
  checklist: completeChecklist(),
  actor: {
    actorType: "human",
    actorId: "human-reviewer",
    explicitHumanAction: true,
  },
  confirmedSourceHash: "source-v1",
  warningsAcknowledged: ["CONTENT_EXTERNAL_LINK"],
  sourceCommit: "abc123",
  ...overrides,
});
