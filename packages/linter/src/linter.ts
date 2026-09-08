import { diagnostic, sortDiagnostics, utf8ByteLength } from "./diagnostics.js";
import { inspectHtmlStages } from "./html-stages.js";
import {
  CANONICAL_FRONTMATTER_FIELDS,
  DEFAULT_LINT_LIMITS,
  LINTER_VERSION,
  RULESET_VERSION,
  WECHAT_PLATFORM_RULES,
} from "./platform-config.js";
import type {
  AssetInventoryItem,
  LintInput,
  LintIssue,
  LintLimits,
  LintReport,
  SafeFixResult,
  SafeFixTransaction,
  SafeFixTransactionResult,
} from "./types.js";

const ARTICLE_STATUSES = new Set([
  "idea",
  "draft",
  "reviewing",
  "reviewed",
  "approved",
  "sent_to_draft",
  "published",
  "failed",
]);

const REQUIRED_TEXT_FIELDS = ["id", "title", "summary", "author"] as const;
const BOOLEAN_FIELDS = [
  "original",
  "ai_assisted",
  "human_reviewed",
  "need_open_comment",
  "only_fans_can_comment",
] as const;

const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  {
    name: "private key",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  },
  { name: "GitHub token", pattern: /\bgh[opusr]_[A-Za-z0-9_]{20,}\b/ },
  { name: "OpenAI key", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  {
    name: "JWT",
    pattern:
      /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  },
  {
    name: "credential assignment",
    pattern:
      /\b(?:password|passwd|appsecret|access[_-]?token|api[_-]?key|client[_-]?secret)\s*[:=]\s*["']?[A-Za-z0-9_./+\-=]{12,}/i,
  },
];

function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizedReference(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function inventoryFor(
  assets: AssetInventoryItem[],
  reference: string,
): AssetInventoryItem | undefined {
  const normalized = normalizedReference(reference);
  return assets.find(
    (asset) => normalizedReference(asset.reference) === normalized,
  );
}

function frontmatterDiagnostic(
  input: LintInput,
  issues: LintIssue[],
  ruleId: string,
  severity: "ERROR" | "WARNING" | "INFO",
  field: string,
  message: string,
  suggestion?: string,
  legacyCode?: string,
): void {
  const value = input.frontmatter[field];
  issues.push(
    diagnostic(ruleId, severity, "frontmatter", message, {
      file: input.articlePath,
      line: 1,
      column: 1,
      excerpt: `${field}: ${JSON.stringify(value)}`.slice(0, 240),
      suggestion,
      legacyCode,
    }),
  );
}

function checkFrontmatter(input: LintInput, issues: LintIssue[]): void {
  const platform = input.platform ?? WECHAT_PLATFORM_RULES;
  const fm = input.frontmatter;
  for (const field of REQUIRED_TEXT_FIELDS) {
    if (!text(fm[field])) {
      frontmatterDiagnostic(
        input,
        issues,
        `frontmatter.${field}.required`,
        "ERROR",
        field,
        `Frontmatter field \`${field}\` is required.`,
        `Set a non-empty ${field} value.`,
      );
    }
  }

  if (!text(fm.theme)) {
    frontmatterDiagnostic(
      input,
      issues,
      "frontmatter.theme.required",
      "ERROR",
      "theme",
      "Theme is required.",
      "Select one of the configured original themes.",
    );
  } else if (!platform.supportedThemes.includes(fm.theme)) {
    frontmatterDiagnostic(
      input,
      issues,
      "frontmatter.theme.unknown",
      "ERROR",
      "theme",
      `Theme \`${fm.theme}\` is not in platform configuration ${platform.configVersion}.`,
      `Choose one of: ${platform.supportedThemes.join(", ")}.`,
    );
  }

  if (!ARTICLE_STATUSES.has(String(fm.status ?? ""))) {
    frontmatterDiagnostic(
      input,
      issues,
      "frontmatter.status.invalid",
      "ERROR",
      "status",
      "Frontmatter status is not a supported MPForge article state.",
      "Use a transition exposed by the content state machine.",
    );
  }

  if (
    fm.slug !== undefined &&
    (typeof fm.slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fm.slug))
  ) {
    frontmatterDiagnostic(
      input,
      issues,
      "frontmatter.slug.invalid",
      "ERROR",
      "slug",
      "Slug must use safe lowercase ASCII kebab-case.",
      "Use characters a-z, 0-9, and single hyphens.",
    );
  }
  if (input.articleSlug && fm.slug !== input.articleSlug) {
    frontmatterDiagnostic(
      input,
      issues,
      "frontmatter.slug.path-conflict",
      "ERROR",
      "slug",
      `Frontmatter slug does not match article directory slug \`${input.articleSlug}\`.`,
      "Rename through the content store so the directory and frontmatter change atomically.",
    );
  }
  if (input.articleId && text(fm.id) && fm.id !== input.articleId) {
    frontmatterDiagnostic(
      input,
      issues,
      "frontmatter.id.path-conflict",
      "ERROR",
      "id",
      "Frontmatter id conflicts with the identity supplied by the content store.",
      "Restore the immutable article id from repository history.",
    );
  }

  for (const field of BOOLEAN_FIELDS) {
    if (typeof fm[field] !== "boolean") {
      const stringBoolean =
        typeof fm[field] === "string" && /^(?:true|false)$/i.test(fm[field]);
      frontmatterDiagnostic(
        input,
        issues,
        stringBoolean
          ? "frontmatter.boolean.string"
          : `frontmatter.${field}.boolean`,
        "ERROR",
        field,
        stringBoolean
          ? `Frontmatter field \`${field}\` was parsed as a string instead of a boolean.`
          : `Frontmatter field \`${field}\` must be a boolean.`,
        `Use an unquoted true or false value.`,
      );
    }
  }
  if (!("original" in fm)) {
    frontmatterDiagnostic(
      input,
      issues,
      "frontmatter.original.required",
      "ERROR",
      "original",
      "Frontmatter field `original` is required.",
      "Declare whether this is original content.",
    );
  }
  if (
    !Array.isArray(fm.ai_tasks) ||
    fm.ai_tasks.some((task) => typeof task !== "string" || !task.trim())
  ) {
    frontmatterDiagnostic(
      input,
      issues,
      "frontmatter.ai_tasks.invalid",
      "ERROR",
      "ai_tasks",
      "Frontmatter field `ai_tasks` must be an array of non-empty strings.",
      "Use [] or a YAML list of specific AI-assisted tasks.",
      "frontmatter.ai_tasks.array",
    );
  }

  const created = text(fm.created_at) ? Date.parse(fm.created_at) : Number.NaN;
  const updated = text(fm.updated_at) ? Date.parse(fm.updated_at) : Number.NaN;
  if (!Number.isFinite(created)) {
    frontmatterDiagnostic(
      input,
      issues,
      "frontmatter.created_at.invalid",
      "ERROR",
      "created_at",
      "Frontmatter field `created_at` must be a valid ISO timestamp.",
      "Use an ISO-8601 timestamp.",
      "frontmatter.created_at.date",
    );
  }
  if (!Number.isFinite(updated)) {
    frontmatterDiagnostic(
      input,
      issues,
      "frontmatter.updated_at.invalid",
      "ERROR",
      "updated_at",
      "Frontmatter field `updated_at` must be a valid ISO timestamp.",
      "Use an ISO-8601 timestamp.",
      "frontmatter.updated_at.date",
    );
  }
  if (
    Number.isFinite(created) &&
    Number.isFinite(updated) &&
    updated < created
  ) {
    frontmatterDiagnostic(
      input,
      issues,
      "frontmatter.updated_at.before-created",
      "ERROR",
      "updated_at",
      "updated_at is earlier than created_at.",
      "Set updated_at to the actual edit time.",
    );
  }

  const publicationPrepared =
    input.publicationPrepared === true ||
    ["reviewed", "approved", "sent_to_draft"].includes(String(fm.status));
  if (!text(fm.account)) {
    frontmatterDiagnostic(
      input,
      issues,
      "frontmatter.account.missing",
      publicationPrepared ? "ERROR" : "WARNING",
      "account",
      "Account alias is not set; publication preparation must remain disabled.",
      "Set a non-secret account alias before review.",
    );
  }

  if (typeof fm.human_reviewed === "boolean") {
    const status = String(fm.status ?? "");
    if (fm.human_reviewed && ["idea", "draft", "reviewing"].includes(status)) {
      frontmatterDiagnostic(
        input,
        issues,
        "frontmatter.human-reviewed.status-conflict",
        "ERROR",
        "human_reviewed",
        "human_reviewed=true conflicts with the current pre-review state.",
        "Use the human review transition or reset human_reviewed to false.",
      );
    }
    if (
      !fm.human_reviewed &&
      ["reviewed", "approved", "sent_to_draft", "published"].includes(status)
    ) {
      frontmatterDiagnostic(
        input,
        issues,
        "frontmatter.human-reviewed.status-conflict",
        "ERROR",
        "human_reviewed",
        "The current state requires human_reviewed=true.",
        "Complete the human checklist through the review gate.",
      );
    }
  }

  if (text(fm.title) && [...fm.title].length > platform.maxTitleCharacters) {
    frontmatterDiagnostic(
      input,
      issues,
      "frontmatter.title.too-long",
      "ERROR",
      "title",
      `Title has ${[...fm.title].length} characters; platform limit is ${platform.maxTitleCharacters}.`,
      "Shorten the title without changing its claim.",
    );
  }
  if (text(fm.author) && [...fm.author].length > platform.maxAuthorCharacters) {
    frontmatterDiagnostic(
      input,
      issues,
      "frontmatter.author.too-long",
      "ERROR",
      "author",
      `Author has ${[...fm.author].length} characters; platform limit is ${platform.maxAuthorCharacters}.`,
      "Use the confirmed concise author name.",
    );
  }
  if (
    text(fm.summary) &&
    [...fm.summary].length > platform.maxSummaryCharacters
  ) {
    frontmatterDiagnostic(
      input,
      issues,
      "frontmatter.summary.too-long",
      "ERROR",
      "summary",
      `Summary has ${[...fm.summary].length} characters; platform limit is ${platform.maxSummaryCharacters}.`,
      "Shorten the summary while preserving the key point.",
    );
  }
  if (
    fm.source_url !== null &&
    fm.source_url !== undefined &&
    fm.source_url !== ""
  ) {
    if (
      typeof fm.source_url !== "string" ||
      !/^https?:\/\/[^\s]+$/i.test(fm.source_url)
    ) {
      frontmatterDiagnostic(
        input,
        issues,
        "frontmatter.source-url.invalid",
        "ERROR",
        "source_url",
        "source_url must be a valid http/https URL or null.",
        "Correct or clear the source URL.",
      );
    } else if (utf8ByteLength(fm.source_url) > platform.maxSourceUrlBytes) {
      frontmatterDiagnostic(
        input,
        issues,
        "frontmatter.source-url.too-long",
        "ERROR",
        "source_url",
        `source_url exceeds ${platform.maxSourceUrlBytes} bytes.`,
        "Use the canonical shorter source URL.",
      );
    }
  }

  const known = new Set(CANONICAL_FRONTMATTER_FIELDS);
  for (const field of Object.keys(fm)
    .filter((field) => !known.has(field))
    .sort()) {
    frontmatterDiagnostic(
      input,
      issues,
      "frontmatter.field.unknown",
      "INFO",
      field,
      `Unknown frontmatter field \`${field}\` is preserved.`,
      "Confirm that downstream consumers understand this extension.",
    );
  }

  const identities = input.projectArticles ?? [];
  if (text(fm.id)) {
    const duplicates = identities.filter(
      (item) => item.id === fm.id && item.articlePath !== input.articlePath,
    );
    if (duplicates.length > 0) {
      frontmatterDiagnostic(
        input,
        issues,
        "frontmatter.id.duplicate",
        "ERROR",
        "id",
        `Article id is already used by ${duplicates[0].articlePath}.`,
        "Generate a unique immutable article id.",
      );
    }
  }
  if (text(fm.slug)) {
    const duplicates = identities.filter(
      (item) => item.slug === fm.slug && item.articlePath !== input.articlePath,
    );
    if (duplicates.length > 0) {
      frontmatterDiagnostic(
        input,
        issues,
        "frontmatter.slug.duplicate",
        "ERROR",
        "slug",
        `Article slug is already used by ${duplicates[0].articlePath}.`,
        "Choose a unique safe slug.",
      );
    }
  }
  if (fm.status === "approved" && input.approvalRecordExists !== true) {
    frontmatterDiagnostic(
      input,
      issues,
      "frontmatter.approved.missing-record",
      "ERROR",
      "status",
      "Approved status has no bound approval record.",
      "Revoke the status and complete interactive human approval.",
    );
  }
}

function checkAssets(
  input: LintInput,
  issues: LintIssue[],
  limits: LintLimits,
): void {
  const assets = input.assets ?? [];
  const imagePattern = /!\[([^\]]*)\]\(([^\s)]+)(?:\s+["'][^"']*["'])?\)/g;
  for (const match of input.markdown.matchAll(imagePattern)) {
    const alt = match[1] ?? "";
    const reference = match[2] ?? "";
    const index = match.index ?? 0;
    if (!alt.trim()) {
      issues.push(
        diagnostic(
          "image.alt.missing",
          "WARNING",
          "accessibility",
          `Image ${reference} has no alt text.`,
          {
            file: input.articlePath,
            source: input.markdown,
            index,
            suggestion: "Add concise descriptive alt text.",
          },
        ),
      );
    }
    if (/^https?:\/\//i.test(reference)) {
      issues.push(
        diagnostic(
          "image.external",
          "ERROR",
          "media",
          `External image must be explicitly imported into article assets: ${reference}`,
          {
            file: input.articlePath,
            source: input.markdown,
            index,
            suggestion:
              "Use the explicit media import operation; ordinary render and lint never download it.",
          },
        ),
      );
      continue;
    }
    if (/^(?:data:|blob:|file:)/i.test(reference)) {
      issues.push(
        diagnostic(
          "image.embedded",
          "ERROR",
          "security",
          "file/data/blob image references are forbidden publication inputs.",
          {
            file: input.articlePath,
            source: input.markdown,
            index,
            suggestion: "Import the file into the article asset directory.",
          },
        ),
      );
      continue;
    }
    const asset = inventoryFor(assets, reference);
    if (!asset?.exists) {
      issues.push(
        diagnostic(
          "image.local.missing",
          "ERROR",
          "media",
          `Local image is missing: ${reference}`,
          {
            file: input.articlePath,
            source: input.markdown,
            index,
            suggestion: "Restore or explicitly import the referenced image.",
          },
        ),
      );
      continue;
    }
    if (
      asset.sizeBytes !== undefined &&
      asset.sizeBytes > limits.maxImageBytes
    ) {
      issues.push(
        diagnostic(
          "image.size.exceeded",
          "WARNING",
          "media",
          `Image exceeds ${limits.maxImageBytes} bytes: ${reference}`,
          {
            file: input.articlePath,
            source: input.markdown,
            index,
            suggestion:
              "Create an optimized derivative; do not overwrite the original.",
          },
        ),
      );
    }
    if (
      (asset.width ?? 0) > limits.maxImageWidth ||
      (asset.height ?? 0) > limits.maxImageHeight
    ) {
      issues.push(
        diagnostic(
          "image.dimensions.exceeded",
          "WARNING",
          "media",
          `Image dimensions exceed the configured limit: ${reference}`,
          {
            file: input.articlePath,
            source: input.markdown,
            index,
            suggestion: "Generate a smaller publication derivative.",
          },
        ),
      );
    }
    if (asset.unsafeSvg) {
      issues.push(
        diagnostic(
          "image.svg.unsafe",
          "ERROR",
          "security",
          `SVG failed the media safety scan: ${reference}`,
          {
            file: input.articlePath,
            source: input.markdown,
            index,
            suggestion: "Sanitize and rasterize it through the media pipeline.",
          },
        ),
      );
    }
  }

  const cover = text(input.frontmatter.cover) ? input.frontmatter.cover : "";
  if (cover) {
    const coverAsset = inventoryFor(assets, cover);
    if (!coverAsset?.exists) {
      frontmatterDiagnostic(
        input,
        issues,
        "frontmatter.cover.missing",
        "ERROR",
        "cover",
        `Cover path does not exist in the asset inventory: ${cover}`,
        "Import or restore the cover and refresh the asset manifest.",
      );
    }
  } else {
    frontmatterDiagnostic(
      input,
      issues,
      "frontmatter.cover.missing",
      "WARNING",
      "cover",
      "Cover is not configured.",
      "Choose a rights-approved local cover before publication.",
    );
  }

  for (const asset of [...assets].sort((a, b) =>
    a.reference.localeCompare(b.reference),
  )) {
    if (asset.rightsStatus === "blocked") {
      issues.push(
        diagnostic(
          "asset.rights.blocked",
          "ERROR",
          "media",
          `Asset rights are blocked: ${asset.reference}`,
          {
            file: input.articlePath,
            excerpt: asset.reference,
            suggestion: "Replace the asset with one whose rights are approved.",
          },
        ),
      );
    } else if (asset.rightsStatus === "pending") {
      issues.push(
        diagnostic(
          "asset.rights.pending",
          "WARNING",
          "media",
          `Asset rights remain pending: ${asset.reference}`,
          {
            file: input.articlePath,
            excerpt: asset.reference,
            suggestion:
              "Complete rights verification; pending assets block final approval in the review gate.",
          },
        ),
      );
    } else if (
      asset.rightsStatus === undefined ||
      asset.rightsStatus === "unknown"
    ) {
      issues.push(
        diagnostic(
          "asset.rights.unknown",
          "WARNING",
          "media",
          `Asset rights are unknown: ${asset.reference}`,
          {
            file: input.articlePath,
            excerpt: asset.reference,
            suggestion:
              "Record the creator, source, license, and rights status.",
          },
        ),
      );
    }
    if (asset.sourceType === "remote" && !text(asset.sourceUrl)) {
      issues.push(
        diagnostic(
          "asset.remote.source-url.missing",
          "ERROR",
          "media",
          `Remote asset is missing source_url: ${asset.reference}`,
          {
            file: input.articlePath,
            excerpt: asset.reference,
            suggestion: "Record the original http/https source URL.",
          },
        ),
      );
    }
    if (asset.requiresAttribution && !text(asset.attribution)) {
      issues.push(
        diagnostic(
          "asset.attribution.missing",
          "ERROR",
          "media",
          `Asset license requires attribution: ${asset.reference}`,
          {
            file: input.articlePath,
            excerpt: asset.reference,
            suggestion:
              "Add the required attribution exactly as the license specifies.",
          },
        ),
      );
    }
  }
}

function checkStructure(
  input: LintInput,
  issues: LintIssue[],
  limits: LintLimits,
): void {
  const source = input.markdown.replace(/\r\n/g, "\n");
  const lines = source.split("\n");
  if (!source.trim()) {
    issues.push(
      diagnostic(
        "content.body.empty",
        "ERROR",
        "content",
        "Article body is empty.",
        {
          file: input.articlePath,
          source,
          suggestion: "Add the reviewed article body.",
        },
      ),
    );
    return;
  }

  let inCode = false;
  let fenceLine = 0;
  let previousHeading = 0;
  const headings = new Map<string, number>();
  const h1Lines: number[] = [];
  const paragraphs = new Map<string, number>();
  let paragraph: string[] = [];
  let paragraphStart = 0;

  const flushParagraph = () => {
    const value = paragraph.join(" ").trim();
    if (value.length > limits.maxParagraphCharacters) {
      issues.push(
        diagnostic(
          "paragraph.too-long",
          "WARNING",
          "content",
          `Paragraph contains ${value.length} characters; configured limit is ${limits.maxParagraphCharacters}.`,
          {
            file: input.articlePath,
            source,
            line: paragraphStart + 1,
            column: 1,
            suggestion: "Split it at a natural argument boundary.",
          },
        ),
      );
    }
    const normalized = value.replace(/\s+/g, " ").toLocaleLowerCase();
    if (normalized.length >= 40) {
      const seen = paragraphs.get(normalized);
      if (seen !== undefined) {
        issues.push(
          diagnostic(
            "paragraph.duplicate",
            "WARNING",
            "content",
            "Repeated paragraph detected.",
            {
              file: input.articlePath,
              source,
              line: paragraphStart + 1,
              column: 1,
              suggestion: `Review duplication; first occurrence is line ${seen}.`,
            },
          ),
        );
      } else paragraphs.set(normalized, paragraphStart + 1);
    }
    paragraph = [];
  };

  lines.forEach((line, index) => {
    if (/^\s*```/.test(line)) {
      flushParagraph();
      if (!inCode) fenceLine = index + 1;
      inCode = !inCode;
      return;
    }
    if (inCode) {
      if (line.length > limits.maxCodeLineCharacters) {
        issues.push(
          diagnostic(
            "code.overflow",
            "WARNING",
            "content",
            `Code line exceeds ${limits.maxCodeLineCharacters} characters.`,
            {
              file: input.articlePath,
              source,
              line: index + 1,
              column: limits.maxCodeLineCharacters + 1,
              suggestion:
                "Wrap the code or enable horizontal scrolling in the compatible template.",
            },
          ),
        );
      }
      return;
    }
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      const title = heading[2]
        .replace(/\s+#+\s*$/, "")
        .trim()
        .toLocaleLowerCase();
      if (level === 1) h1Lines.push(index + 1);
      if (previousHeading > 0 && level > previousHeading + 1) {
        issues.push(
          diagnostic(
            "heading.level.jump",
            "WARNING",
            "content",
            `Heading level jumps from H${previousHeading} to H${level}.`,
            {
              file: input.articlePath,
              source,
              line: index + 1,
              column: 1,
              suggestion: "Use a sequential heading hierarchy.",
            },
          ),
        );
      }
      const seen = headings.get(title);
      if (seen !== undefined) {
        issues.push(
          diagnostic(
            "heading.duplicate",
            "WARNING",
            "content",
            `Duplicate heading: ${heading[2]}`,
            {
              file: input.articlePath,
              source,
              line: index + 1,
              column: 1,
              suggestion: `Use a distinct heading; first occurrence is line ${seen}.`,
            },
          ),
        );
      } else headings.set(title, index + 1);
      const next = lines.slice(index + 1).find((candidate) => candidate.trim());
      if (next === undefined || /^#{1,6}\s+/.test(next)) {
        issues.push(
          diagnostic(
            "heading.body.missing",
            "WARNING",
            "content",
            `Heading has no body content: ${heading[2]}`,
            {
              file: input.articlePath,
              source,
              line: index + 1,
              column: 1,
              suggestion: "Add content or remove the empty section.",
            },
          ),
        );
      }
      previousHeading = level;
      return;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushParagraph();
      const columns = Math.max(0, line.split("|").length - 2);
      if (columns > limits.maxTableColumns) {
        issues.push(
          diagnostic(
            "table.too-wide",
            "WARNING",
            "content",
            `Table has ${columns} columns; mobile preview may overflow.`,
            {
              file: input.articlePath,
              source,
              line: index + 1,
              column: 1,
              suggestion: "Reduce columns or provide a mobile fallback.",
            },
          ),
        );
      }
      return;
    }
    if (!line.trim()) flushParagraph();
    else if (!/^\s*(?:[-+*]|\d+\.)\s+/.test(line) && !/^\s*>/.test(line)) {
      if (paragraph.length === 0) paragraphStart = index;
      paragraph.push(line.trim());
    }
  });
  flushParagraph();

  if (inCode) {
    issues.push(
      diagnostic(
        "markdown.code-fence.unclosed",
        "ERROR",
        "content",
        "Markdown code fence is not closed.",
        {
          file: input.articlePath,
          source,
          line: fenceLine,
          column: 1,
          suggestion: "Add the matching closing fence.",
        },
      ),
    );
  }
  if (h1Lines.length > 1) {
    issues.push(
      diagnostic(
        "heading.h1.multiple",
        "WARNING",
        "content",
        `Article contains ${h1Lines.length} level-one headings.`,
        {
          file: input.articlePath,
          source,
          line: h1Lines[1],
          column: 1,
          suggestion:
            "Keep one article title and use lower-level section headings.",
        },
      ),
    );
  }
  const blank = /\n[\t ]*\n[\t ]*\n+/g.exec(source);
  if (blank) {
    issues.push(
      diagnostic(
        "paragraph.empty",
        "INFO",
        "content",
        "Document contains repeated empty paragraphs.",
        {
          file: input.articlePath,
          source,
          index: blank.index,
          suggestion: "Collapse repeated blank lines.",
          autofixAvailable: true,
          autofixSafe: true,
        },
      ),
    );
  }
}

function checkLinksAndSyntax(input: LintInput, issues: LintIssue[]): void {
  const source = input.markdown;
  const assets = input.assets ?? [];
  for (const match of source.matchAll(/(?<!!)\[([^\]]*)\]\(([^)]*)\)/g)) {
    const label = (match[1] ?? "").trim();
    const target = (match[2] ?? "").trim().replace(/\s+["'][^"']*["']$/, "");
    const index = match.index ?? 0;
    if (!target) {
      issues.push(
        diagnostic(
          "link.target.empty",
          "ERROR",
          "content",
          "Link target is empty.",
          {
            file: input.articlePath,
            source,
            index,
            suggestion: "Add a valid target or remove the link markup.",
          },
        ),
      );
    }
    if (!label || /^https?:\/\//i.test(label)) {
      issues.push(
        diagnostic(
          "link.text.unrecognizable",
          "WARNING",
          "accessibility",
          "Link has no recognizable descriptive text.",
          {
            file: input.articlePath,
            source,
            index,
            suggestion: "Use concise text that describes the destination.",
          },
        ),
      );
    }
    if (/^file:/i.test(target)) {
      issues.push(
        diagnostic(
          "link.file-uri",
          "ERROR",
          "security",
          "file:// links expose local machine paths.",
          {
            file: input.articlePath,
            source,
            index,
            suggestion:
              "Remove it or link an explicitly imported project asset.",
          },
        ),
      );
    } else if (target && !/^(?:https?:\/\/|mailto:|#)/i.test(target)) {
      const asset = inventoryFor(assets, target);
      if (!asset?.exists) {
        issues.push(
          diagnostic(
            "link.local.missing",
            "ERROR",
            "content",
            `Local link target is missing: ${target}`,
            {
              file: input.articlePath,
              source,
              index,
              suggestion: "Restore the target or correct the relative link.",
            },
          ),
        );
      }
    }
  }

  const external = Array.from(
    source.matchAll(/(?<!!)\[[^\]]*\]\((https?:\/\/[^\s)]+)/g),
  );
  for (const match of external) {
    issues.push(
      diagnostic(
        "link.external",
        "INFO",
        "content",
        `External link requires publication review: ${match[1]}`,
        {
          file: input.articlePath,
          source,
          index: match.index ?? 0,
          suggestion: "Verify the destination, claim, and link text.",
        },
      ),
    );
  }
  const platform = input.platform ?? WECHAT_PLATFORM_RULES;
  if (external.length > platform.maxExternalLinks) {
    issues.push(
      diagnostic(
        "link.external.excessive",
        "WARNING",
        "content",
        `Article contains ${external.length} external links; configured review threshold is ${platform.maxExternalLinks}.`,
        {
          file: input.articlePath,
          source,
          suggestion:
            "Confirm every external link is necessary and trustworthy.",
        },
      ),
    );
  }

  for (const match of source.matchAll(/\[\^([^\]]+)\]/g)) {
    const id = match[1];
    const definitions = new RegExp(
      `^\\[\\^${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]:`,
      "m",
    );
    if (!definitions.test(source)) {
      issues.push(
        diagnostic(
          "footnote.reference.missing",
          "WARNING",
          "content",
          `Footnote reference [^${id}] has no definition.`,
          {
            file: input.articlePath,
            source,
            index: match.index ?? 0,
            suggestion: "Add the matching footnote definition.",
          },
        ),
      );
    }
  }
  const quoteIncomplete = /^>\s*(?:TODO|TBD|\.\.\.|…)?\s*$/im.exec(source);
  if (quoteIncomplete) {
    issues.push(
      diagnostic(
        "quote.incomplete",
        "WARNING",
        "content",
        "Block quote appears incomplete.",
        {
          file: input.articlePath,
          source,
          index: quoteIncomplete.index,
          suggestion: "Complete the quote and verify its source.",
        },
      ),
    );
  }
  const openBrackets = (source.match(/\[/g) ?? []).length;
  const closeBrackets = (source.match(/\]/g) ?? []).length;
  if (openBrackets !== closeBrackets) {
    issues.push(
      diagnostic(
        "markdown.structure.suspicious",
        "WARNING",
        "content",
        "Markdown has an unmatched square bracket.",
        {
          file: input.articlePath,
          source,
          suggestion: "Correct the incomplete Markdown link or image syntax.",
        },
      ),
    );
  }
}

function checkContentSafety(input: LintInput, issues: LintIssue[]): void {
  const source = input.markdown;
  const placeholderPatterns: Array<[RegExp, string]> = [
    [/\b(?:TODO|TBD|FIXME)\b/i, "task marker"],
    [/\$\{[A-Z_][A-Z0-9_]*\}/, "environment placeholder"],
    [/\{\{\s*[\w.-]+\s*\}\}/, "template placeholder"],
    [/(?:待补充|占位符|\[insert[^\]]*\])/i, "editorial placeholder"],
  ];
  for (const [pattern, label] of placeholderPatterns) {
    const match = pattern.exec(source);
    if (match) {
      issues.push(
        diagnostic(
          "content.placeholder",
          "ERROR",
          "content",
          `Unfinished ${label}: ${match[0]}`,
          {
            file: input.articlePath,
            source,
            index: match.index,
            suggestion: "Resolve it manually; automatic deletion is not safe.",
          },
        ),
      );
    }
  }

  const absolute =
    /(?:\b[A-Za-z]:[\\/](?:[^\s)]+)|(?:^|[\s(])\/(?:Users|home|var|tmp|private)\/[^\s)]+)/m.exec(
      source,
    );
  if (absolute) {
    issues.push(
      diagnostic(
        "path.absolute.local",
        "ERROR",
        "security",
        "Document contains a local absolute path.",
        {
          file: input.articlePath,
          source,
          index: absolute.index,
          suggestion: "Import the asset and use an article-relative path.",
        },
      ),
    );
  }
  const machineResidue =
    /(?:\\Users\\[^\\\s]+|\/Users\/[^/\s]+|\/home\/[^/\s]+|AppData[\\/]|node_modules[\\/])/i.exec(
      source,
    );
  if (machineResidue) {
    issues.push(
      diagnostic(
        "path.machine-residue",
        "ERROR",
        "security",
        "Possible local-machine path remains in article content.",
        {
          file: input.articlePath,
          source,
          index: machineResidue.index,
          suggestion: "Remove machine-specific information.",
        },
      ),
    );
  }

  for (const secret of SECRET_PATTERNS) {
    const match = secret.pattern.exec(source);
    if (match) {
      issues.push(
        diagnostic(
          "secret.possible",
          "ERROR",
          "security",
          `Possible ${secret.name} disclosure.`,
          {
            file: input.articlePath,
            source,
            index: match.index,
            suggestion:
              "Remove the value and rotate the credential if it was real.",
          },
        ),
      );
    }
  }

  const debug =
    /\b(?:console\.(?:log|debug)|print\(\s*["']DEBUG|debugger;|TRACE:)\b/i.exec(
      source,
    );
  if (debug) {
    issues.push(
      diagnostic(
        "content.debug-residue",
        "WARNING",
        "content",
        "Possible debugging output remains in the article.",
        {
          file: input.articlePath,
          source,
          index: debug.index,
          suggestion:
            "Confirm whether the example belongs in the final article.",
        },
      ),
    );
  }
  const testText =
    /\b(?:lorem ipsum|dummy text|test test test|example only)\b/i.exec(source);
  if (testText) {
    issues.push(
      diagnostic(
        "content.test-residue",
        "WARNING",
        "content",
        "Possible test text remains in the article.",
        {
          file: input.articlePath,
          source,
          index: testText.index,
          suggestion: "Replace it with reviewed publication content.",
        },
      ),
    );
  }
  const unbroken = /\b[A-Za-z0-9_./+\-=]{121,}\b/.exec(source);
  if (unbroken) {
    issues.push(
      diagnostic(
        "content.unbroken-run",
        "WARNING",
        "content",
        "A very long unbroken English/code-like run may overflow mobile layout.",
        {
          file: input.articlePath,
          source,
          index: unbroken.index,
          suggestion: "Wrap or shorten the run without altering its meaning.",
        },
      ),
    );
  }
  const aiPhrases = [
    "作为一个 AI",
    "下面是为你生成的",
    "当然可以",
    "希望对你有所帮助",
  ];
  for (const phrase of aiPhrases) {
    const index = source.indexOf(phrase);
    if (index >= 0) {
      issues.push(
        diagnostic(
          "content.ai-residue.possible",
          "WARNING",
          "content",
          `Possible assistant-conversation residue: ${phrase}`,
          {
            file: input.articlePath,
            source,
            index,
            suggestion:
              "Review the phrase in context; this rule does not determine authorship.",
          },
        ),
      );
    }
  }

  const platform = input.platform ?? WECHAT_PLATFORM_RULES;
  if ([...source].length > platform.maxContentCharacters) {
    issues.push(
      diagnostic(
        "content.length.exceeded",
        "ERROR",
        "wechat",
        `Content exceeds the configured ${platform.maxContentCharacters}-character platform limit.`,
        {
          file: input.articlePath,
          source,
          suggestion:
            "Edit the article intentionally; the linter will not truncate it.",
        },
      ),
    );
  }
  if (utf8ByteLength(source) >= platform.maxContentBytes) {
    issues.push(
      diagnostic(
        "content.bytes.exceeded",
        "ERROR",
        "wechat",
        `Content reaches the configured ${platform.maxContentBytes}-byte platform limit.`,
        {
          file: input.articlePath,
          source,
          suggestion: "Reduce content size manually and rebuild.",
        },
      ),
    );
  }
}

function checkDeterminism(input: LintInput, issues: LintIssue[]): void {
  if (!input.determinism) {
    issues.push(
      diagnostic(
        "build.determinism.unverified",
        "WARNING",
        "build",
        "No repeated-render hash evidence was supplied.",
        {
          file: input.articlePath,
          suggestion: "Render twice and supply both hashes before approval.",
        },
      ),
    );
    return;
  }
  if (input.determinism.firstHtmlHash !== input.determinism.secondHtmlHash) {
    issues.push(
      diagnostic(
        "build.nondeterministic",
        "ERROR",
        "build",
        "Repeated renders produced different HTML hashes.",
        {
          file: input.articlePath,
          excerpt: `${input.determinism.firstHtmlHash} != ${input.determinism.secondHtmlHash}`,
          suggestion:
            "Remove time, randomness, network, and unstable iteration order from rendering.",
        },
      ),
    );
  }
}

export function lintArticle(input: LintInput): LintReport {
  const issues: LintIssue[] = [];
  const limits = { ...DEFAULT_LINT_LIMITS, ...input.limits };
  checkFrontmatter(input, issues);
  checkAssets(input, issues, limits);
  checkStructure(input, issues, limits);
  checkLinksAndSyntax(input, issues);
  checkContentSafety(input, issues);
  checkDeterminism(input, issues);

  if (input.renderedHtml !== undefined) {
    issues.push(
      ...inspectHtmlStages({
        file: input.articlePath,
        // Raw author HTML must remain visible to the gate even if the renderer
        // already stripped it from its output.
        rawHtml: `${markdownWithoutCode(input.markdown)}\n${input.renderedHtml}`,
        safeHtml: input.safeHtml,
        wechatHtml: input.wechatHtml,
        css: input.renderedCss,
        platform: input.platform,
      }).diagnostics,
    );
  } else if (/<\/?[a-z][\s\S]*>/i.test(input.markdown)) {
    issues.push(
      ...inspectHtmlStages({
        file: input.articlePath,
        rawHtml: input.markdown,
        css: input.renderedCss,
        platform: input.platform,
      }).diagnostics,
    );
  }

  sortDiagnostics(issues);
  const summary = {
    errors: issues.filter((item) => item.severity === "ERROR").length,
    warnings: issues.filter((item) => item.severity === "WARNING").length,
    info: issues.filter((item) => item.severity === "INFO").length,
  };
  const report: LintReport = {
    schema: "mpforge.lint/v1",
    articlePath: input.articlePath,
    passed: summary.errors === 0,
    summary,
    issues,
    article_id: text(input.frontmatter.id) ? input.frontmatter.id : "",
    source_hash: input.sourceHash ?? "unavailable",
    rendered_html_hash: input.renderedHtmlHash ?? "unavailable",
    linter_version: LINTER_VERSION,
    ruleset_version: RULESET_VERSION,
    generated_at: input.generatedAt ?? "1970-01-01T00:00:00.000Z",
    error_count: summary.errors,
    warning_count: summary.warnings,
    info_count: summary.info,
    publish_blocked: summary.errors > 0,
    diagnostics: issues,
    applied_fixes: [],
  };
  return report;
}

/** Preserve authored raw HTML while preventing code examples from becoming tags. */
function markdownWithoutCode(markdown: string): string {
  const withoutFences = markdown.replace(
    /(^|\n)([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\2\3(?=\n|$)/g,
    (block) => block.replace(/[^\n]/g, " "),
  );
  return withoutFences.replace(/`[^`\n]*`/g, (code) => " ".repeat(code.length));
}

export function canCreateDraft(report: LintReport): boolean {
  return report.summary.errors === 0 && !report.publish_blocked;
}

export function applySafeFixes(markdown: string): SafeFixResult {
  const applied: string[] = [];
  let next = markdown.replace(/\r\n/g, "\n");
  const trailing = next
    .split("\n")
    .map((line) => line.replace(/[\t ]+$/g, ""))
    .join("\n");
  if (trailing !== next) applied.push("whitespace.trailing");
  next = trailing;
  const collapsed = next.replace(/\n[\t ]*\n[\t ]*\n+/g, "\n\n");
  if (collapsed !== next) applied.push("paragraph.empty");
  return { markdown: collapsed, applied };
}

/**
 * Storage-neutral backup/write/validate/rollback protocol. Callers choose the
 * durable filesystem or browser transaction implementation; this engine never
 * rewrites large prose or deletes content to make a diagnostic disappear.
 */
export async function applySafeFixesTransactional(
  transaction: SafeFixTransaction,
): Promise<SafeFixTransactionResult> {
  const fixed = applySafeFixes(transaction.markdown);
  if (fixed.applied.length === 0) {
    return { ...fixed, backupCreated: false, rolledBack: false };
  }
  let backupCreated = false;
  try {
    await transaction.createBackup(transaction.markdown);
    backupCreated = true;
    await transaction.write(fixed.markdown);
    const valid = await transaction.validate?.(fixed.markdown);
    if (valid === false) throw new Error("Safe-fix validation failed");
    return { ...fixed, backupCreated, rolledBack: false };
  } catch (error) {
    if (backupCreated) await transaction.rollback(transaction.markdown);
    throw Object.assign(
      new Error(
        error instanceof Error ? error.message : "Safe-fix transaction failed",
      ),
      { backupCreated, rolledBack: backupCreated },
    );
  }
}

export function formatLintText(report: LintReport): string {
  const lines = report.issues.map(
    (item) =>
      `${item.file}:${item.line}:${item.column} ${item.severity} ${item.rule_id} ${item.message}`,
  );
  lines.push(
    `${report.passed ? "PASS" : "FAIL"}: ${report.summary.errors} error(s), ${report.summary.warnings} warning(s), ${report.summary.info} info`,
  );
  return `${lines.join("\n")}\n`;
}

function escapeAnnotation(value: string): string {
  return value
    .replace(/%/g, "%25")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A")
    .replace(/:/g, "%3A")
    .replace(/,/g, "%2C");
}

export function formatGitHubAnnotations(report: LintReport): string[] {
  return report.issues.map((item) => {
    const command =
      item.severity === "ERROR"
        ? "error"
        : item.severity === "WARNING"
          ? "warning"
          : "notice";
    return `::${command} file=${escapeAnnotation(item.file)},line=${item.line},col=${item.column},title=${escapeAnnotation(item.rule_id)}::${escapeAnnotation(item.message)}`;
  });
}
