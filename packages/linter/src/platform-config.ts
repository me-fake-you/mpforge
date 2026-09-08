import type { LintLimits, PlatformRules } from "./types.js";

/**
 * Central platform configuration. Source: WeChat Official Account draft/add,
 * verified 2026-09-01:
 * https://developers.weixin.qq.com/doc/service/api/draftbox/draftmanage/api_draft_add
 * The compatibility simulator is not claimed to match every client transform.
 */
export const WECHAT_PLATFORM_RULES: PlatformRules = Object.freeze({
  platform: "wechat-official-account",
  configVersion: "wechat-draft-add/2026-09-01",
  verifiedAt: "2026-09-01",
  sourceUrl:
    "https://developers.weixin.qq.com/doc/service/api/draftbox/draftmanage/api_draft_add",
  maxTitleCharacters: 32,
  maxAuthorCharacters: 16,
  maxSummaryCharacters: 120,
  maxContentCharacters: 20_000,
  maxContentBytes: 1024 * 1024,
  maxSourceUrlBytes: 1024,
  maxExternalLinks: 20,
  mobileViewportWidth: 402,
  supportedThemes: [
    "minimal",
    "academic-blue",
    "warm-editorial",
    "tech-dark-accent",
  ],
});

export const DEFAULT_LINT_LIMITS: LintLimits = Object.freeze({
  maxImageBytes: 2 * 1024 * 1024,
  maxImageWidth: 4096,
  maxImageHeight: 4096,
  maxParagraphCharacters: 600,
  maxCodeLineCharacters: 100,
  maxTableColumns: 6,
});

export const LINTER_VERSION = "0.2.0";
export const RULESET_VERSION = "mpforge-wechat-preflight/2026-09-01";

export const CANONICAL_FRONTMATTER_FIELDS = Object.freeze([
  "schema_version",
  "version",
  "id",
  "slug",
  "title",
  "summary",
  "author",
  "account",
  "theme",
  "status",
  "cover",
  "source_url",
  "original",
  "ai_assisted",
  "ai_tasks",
  "human_reviewed",
  "need_open_comment",
  "only_fans_can_comment",
  "created_at",
  "updated_at",
]);
