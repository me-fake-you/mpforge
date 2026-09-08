export type LintSeverity = "ERROR" | "WARNING" | "INFO";

export type LintCategory =
  | "frontmatter"
  | "content"
  | "html"
  | "css"
  | "media"
  | "security"
  | "accessibility"
  | "wechat"
  | "build";

export interface LintLocation {
  line: number;
  column: number;
}

/** Canonical Round 2 diagnostic with Round 1 compatibility aliases. */
export interface LintIssue {
  rule_id: string;
  severity: LintSeverity;
  category: LintCategory;
  message: string;
  file: string;
  line: number;
  column: number;
  excerpt: string;
  suggestion: string;
  autofix_available: boolean;
  autofix_safe: boolean;
  documentation_key: string;
  fingerprint: string;
  code: string;
  location: LintLocation;
  autoFixable: boolean;
}

export type AssetSourceType =
  | "local"
  | "remote"
  | "generated"
  | "user_owned"
  | "project_asset";

export type AssetRightsStatus = "approved" | "pending" | "blocked" | "unknown";

export interface AssetInventoryItem {
  reference: string;
  exists: boolean;
  sizeBytes?: number;
  width?: number;
  height?: number;
  sha256?: string;
  localPath?: string;
  sourceType?: AssetSourceType;
  sourceUrl?: string | null;
  rightsStatus?: AssetRightsStatus;
  license?: string | null;
  attribution?: string | null;
  requiresAttribution?: boolean;
  mimeType?: string;
  unsafeSvg?: boolean;
}

export interface DeterminismEvidence {
  firstHtmlHash: string;
  secondHtmlHash: string;
}

export interface ProjectArticleIdentity {
  id: string;
  slug: string;
  articlePath: string;
}

export interface PlatformRules {
  platform: "wechat-official-account";
  configVersion: string;
  verifiedAt: string;
  sourceUrl: string;
  maxTitleCharacters: number;
  maxAuthorCharacters: number;
  maxSummaryCharacters: number;
  maxContentCharacters: number;
  maxContentBytes: number;
  maxSourceUrlBytes: number;
  maxExternalLinks: number;
  mobileViewportWidth: number;
  supportedThemes: readonly string[];
}

export interface LintInput {
  articlePath: string;
  articleSlug?: string;
  articleId?: string;
  frontmatter: Record<string, unknown>;
  markdown: string;
  renderedHtml?: string;
  renderedCss?: string;
  safeHtml?: string;
  wechatHtml?: string;
  assets?: AssetInventoryItem[];
  projectArticles?: ProjectArticleIdentity[];
  determinism?: DeterminismEvidence;
  limits?: Partial<LintLimits>;
  platform?: PlatformRules;
  sourceHash?: string;
  renderedHtmlHash?: string;
  generatedAt?: string;
  approvalRecordExists?: boolean;
  publicationPrepared?: boolean;
}

export interface LintLimits {
  maxImageBytes: number;
  maxImageWidth: number;
  maxImageHeight: number;
  maxParagraphCharacters: number;
  maxCodeLineCharacters: number;
  maxTableColumns: number;
}

export interface LintSummary {
  errors: number;
  warnings: number;
  info: number;
}

export interface AppliedFix {
  rule_id: string;
  changed: boolean;
  applied_at?: string;
}

export interface LintReport {
  schema: "mpforge.lint/v1";
  articlePath: string;
  passed: boolean;
  summary: LintSummary;
  issues: LintIssue[];
  article_id: string;
  source_hash: string;
  rendered_html_hash: string;
  linter_version: string;
  ruleset_version: string;
  generated_at: string;
  error_count: number;
  warning_count: number;
  info_count: number;
  publish_blocked: boolean;
  diagnostics: LintIssue[];
  applied_fixes: AppliedFix[];
}

export interface SafeFixResult {
  markdown: string;
  applied: string[];
}

export interface SafeFixTransaction {
  markdown: string;
  createBackup: (original: string) => void | Promise<void>;
  write: (updated: string) => void | Promise<void>;
  rollback: (original: string) => void | Promise<void>;
  validate?: (updated: string) => boolean | void | Promise<boolean | void>;
}

export interface SafeFixTransactionResult extends SafeFixResult {
  backupCreated: boolean;
  rolledBack: boolean;
}

export interface HtmlStageInput {
  file: string;
  rawHtml: string;
  safeHtml?: string;
  wechatHtml?: string;
  css?: string;
  platform?: PlatformRules;
}

export interface HtmlStageReport {
  raw: LintIssue[];
  safe: LintIssue[];
  wechat: LintIssue[];
  diagnostics: LintIssue[];
}

export interface SarifLog {
  version: "2.1.0";
  $schema: string;
  runs: Array<{
    tool: {
      driver: {
        name: string;
        version: string;
        rules: Array<Record<string, unknown>>;
      };
    };
    results: Array<Record<string, unknown>>;
  }>;
}
