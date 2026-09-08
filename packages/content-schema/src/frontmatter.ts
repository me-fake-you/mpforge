import {
  CONTENT_SCHEMA_ID,
  CONTENT_SCHEMA_VERSION,
  type ArticleFrontmatter,
  type ArticleFrontmatterPatch,
  type ArticleMigrationResult,
  type FrontmatterValue,
  type FrontmatterValidationResult,
  type ParsedArticleDocument,
  type RuntimeSchemaResult,
} from "./types.js";
import { assertValidSlug, generateSlug } from "./paths.js";

const FRONTMATTER_REGEX = /^(\uFEFF)?---(\r?\n)([\s\S]*?)\2---(?:\r?\n|$)/;
const ISO_DATE_PATTERN =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/;
const REQUIRED_FIELDS = [
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
  "version",
] as const;

export class FrontmatterParseError extends Error {
  readonly line: number;

  constructor(message: string, line: number) {
    super(`Invalid YAML frontmatter at line ${line}: ${message}`);
    this.name = "FrontmatterParseError";
    this.line = line;
  }
}

function detectLineEnding(content: string): "\n" | "\r\n" {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

function unquote(value: string, line: number): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) return trimmed;
  const quote = trimmed[0];
  if (
    (quote !== '"' && quote !== "'") ||
    trimmed[trimmed.length - 1] !== quote
  ) {
    return trimmed;
  }
  if (quote === '"') {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      throw new FrontmatterParseError("invalid double-quoted string", line);
    }
  }
  return trimmed.slice(1, -1).replace(/''/g, "'");
}

function isFrontmatterValue(value: unknown): value is FrontmatterValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return true;
  if (Array.isArray(value)) return value.every(isFrontmatterValue);
  if (value && typeof value === "object")
    return Object.values(value as Record<string, unknown>).every(
      isFrontmatterValue,
    );
  return false;
}

function parseValue(raw: string, line: number): FrontmatterValue {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null" || trimmed === "~") return null;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed)) {
    const number = Number(trimmed);
    if (Number.isFinite(number)) return number;
  }
  if (
    (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
    (trimmed.startsWith("{") && trimmed.endsWith("}"))
  ) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (!isFrontmatterValue(parsed))
        throw new FrontmatterParseError("unsupported value", line);
      return parsed;
    } catch {
      throw new FrontmatterParseError("invalid inline array or object", line);
    }
  }
  if (trimmed.startsWith("[") || trimmed.startsWith("{"))
    throw new FrontmatterParseError(
      "unterminated inline array or object",
      line,
    );
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
    if (!trimmed.endsWith(trimmed[0]))
      throw new FrontmatterParseError("unterminated quoted string", line);
  }
  return unquote(trimmed, line);
}

function quoteString(value: string): string {
  return JSON.stringify(value);
}

function serializeValue(value: FrontmatterValue): string {
  if (typeof value === "string") return quoteString(value);
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  return JSON.stringify(value);
}

function splitFrontmatter(content: string) {
  const match = content.match(FRONTMATTER_REGEX);
  if (!match) {
    const hasBom = content.startsWith("\uFEFF");
    const withoutBom = hasBom ? content.slice(1) : content;
    if (/^---(?:\r?\n|$)/.test(withoutBom))
      throw new FrontmatterParseError("missing closing --- delimiter", 1);
    return {
      hasFrontmatter: false,
      frontmatter: "",
      body: hasBom ? content.slice(1) : content,
      hasBom,
      lineEnding: detectLineEnding(content),
    } as const;
  }
  return {
    hasFrontmatter: true,
    frontmatter: match[3],
    body: content
      .slice(match[0].length)
      .replace(match[2] === "\r\n" ? /^\r\n/ : /^\n/, ""),
    hasBom: Boolean(match[1]),
    lineEnding: match[2] === "\r\n" ? ("\r\n" as const) : ("\n" as const),
  } as const;
}

export function parseFrontmatter(
  raw: string,
): Record<string, FrontmatterValue> {
  const result: Record<string, FrontmatterValue> = Object.create(
    null,
  ) as Record<string, FrontmatterValue>;
  const lines = raw.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    if (/^\s/.test(line))
      throw new FrontmatterParseError("unexpected indentation", index + 1);
    const match = /^([^:#][^:]*):(?:[ \t]*(.*))?$/.exec(line);
    if (!match)
      throw new FrontmatterParseError("expected key: value", index + 1);
    const key = match[1]!.trim();
    if (!key || ["__proto__", "prototype", "constructor"].includes(key))
      throw new FrontmatterParseError("invalid key", index + 1);
    if (Object.prototype.hasOwnProperty.call(result, key))
      throw new FrontmatterParseError(`duplicate key ${key}`, index + 1);
    const rawValue = match[2] ?? "";
    if (!rawValue.trim()) {
      const items: FrontmatterValue[] = [];
      let cursor = index + 1;
      while (cursor < lines.length) {
        const nested = lines[cursor]!;
        if (!nested.trim()) {
          cursor += 1;
          continue;
        }
        const item = /^\s+-\s*(.*)$/.exec(nested);
        if (!item) break;
        items.push(parseValue(item[1]!, cursor + 1));
        cursor += 1;
      }
      if (items.length) {
        result[key] = items;
        index = cursor - 1;
      } else {
        result[key] = null;
      }
      continue;
    }
    result[key] = parseValue(rawValue, index + 1);
  }
  return result;
}

export function parseArticleDocument(content: string): ParsedArticleDocument {
  const split = splitFrontmatter(content);
  const frontmatter = split.hasFrontmatter
    ? parseFrontmatter(split.frontmatter)
    : {};
  const diagnostics: string[] = [];
  if (!split.hasFrontmatter)
    diagnostics.push("Missing frontmatter; treated as legacy content");
  return {
    frontmatter,
    body: split.body,
    hasFrontmatter: split.hasFrontmatter,
    legacy:
      !split.hasFrontmatter ||
      frontmatter.schema_version !== CONTENT_SCHEMA_VERSION,
    hasBom: split.hasBom,
    lineEnding: split.lineEnding,
    diagnostics,
  };
}

export function createDefaultFrontmatter(
  input: Partial<ArticleFrontmatter> = {},
  now = new Date().toISOString(),
): ArticleFrontmatter {
  const id = input.id || "";
  const base: ArticleFrontmatter = {
    schema_version: CONTENT_SCHEMA_VERSION,
    id,
    slug: input.slug || (id ? generateSlug(id) : ""),
    title: input.title || "",
    summary: input.summary || "",
    author: input.author || "",
    account: input.account || "",
    theme: input.theme || "minimal",
    status: input.status || "idea",
    cover: input.cover ?? null,
    source_url: input.source_url ?? null,
    original: input.original ?? true,
    ai_assisted: input.ai_assisted ?? false,
    ai_tasks: input.ai_tasks ? [...input.ai_tasks] : [],
    human_reviewed: input.human_reviewed ?? false,
    need_open_comment: input.need_open_comment ?? true,
    only_fans_can_comment: input.only_fans_can_comment ?? false,
    created_at: input.created_at || now,
    updated_at: input.updated_at || now,
    version: input.version ?? 1,
  };
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) base[key] = value;
  }
  return base;
}

export function validateFrontmatter(
  input: unknown,
): FrontmatterValidationResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      valid: false,
      errors: ["Frontmatter must be an object"],
      warnings: [],
    };
  }
  const value = input as Record<string, unknown>;
  const errors: string[] = [];
  for (const field of REQUIRED_FIELDS) {
    if (!(field in value)) errors.push(`Missing required field: ${field}`);
  }
  const strings = ["id", "title", "summary", "author", "account", "theme"];
  strings.push("slug");
  for (const field of strings) {
    if (field in value && typeof value[field] !== "string")
      errors.push(`${field} must be a string`);
  }
  for (const field of ["id", "title", "theme"]) {
    if (typeof value[field] === "string" && !(value[field] as string).trim())
      errors.push(`${field} must not be empty`);
  }
  if (typeof value.slug === "string") {
    try {
      assertValidSlug(value.slug);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "slug is invalid");
    }
  }
  if (
    "version" in value &&
    (!Number.isInteger(value.version) || (value.version as number) < 1)
  )
    errors.push("version must be a positive integer");
  if (
    "schema_version" in value &&
    value.schema_version !== CONTENT_SCHEMA_VERSION
  ) {
    errors.push(`schema_version must be ${CONTENT_SCHEMA_VERSION}`);
  }
  if (
    "status" in value &&
    (typeof value.status !== "string" || !isArticleStatus(value.status))
  ) {
    errors.push("status must be a supported article status");
  }
  for (const field of [
    "original",
    "ai_assisted",
    "human_reviewed",
    "need_open_comment",
    "only_fans_can_comment",
  ]) {
    if (field in value && typeof value[field] !== "boolean")
      errors.push(`${field} must be a boolean`);
  }
  if (
    "ai_tasks" in value &&
    (!Array.isArray(value.ai_tasks) ||
      value.ai_tasks.some((task) => typeof task !== "string"))
  ) {
    errors.push("ai_tasks must be an array of strings");
  }
  for (const field of ["cover", "source_url"]) {
    if (
      field in value &&
      value[field] !== null &&
      typeof value[field] !== "string"
    )
      errors.push(`${field} must be a string or null`);
  }
  for (const field of ["created_at", "updated_at"]) {
    if (
      field in value &&
      (typeof value[field] !== "string" ||
        !ISO_DATE_PATTERN.test(value[field] as string) ||
        Number.isNaN(Date.parse(value[field] as string)))
    ) {
      errors.push(`${field} must be an ISO date string`);
    }
  }
  for (const [field, item] of Object.entries(value)) {
    if (!isFrontmatterValue(item))
      errors.push(`${field} contains an unsupported frontmatter value`);
  }
  return {
    valid: errors.length === 0,
    errors,
    warnings: [],
    ...(errors.length === 0 ? { value: value as ArticleFrontmatter } : {}),
  };
}

/** A dependency-free runtime schema with parse/safeParse semantics. */
export const ArticleSchema = {
  safeParse(input: unknown): RuntimeSchemaResult<ArticleFrontmatter> {
    const result = validateFrontmatter(input);
    return result.valid
      ? { success: true, data: result.value, errors: [] }
      : { success: false, errors: result.errors };
  },
  parse(input: unknown): ArticleFrontmatter {
    const result = validateFrontmatter(input);
    if (!result.valid || !result.value)
      throw new Error(
        `Invalid Article frontmatter: ${result.errors.join("; ")}`,
      );
    return result.value;
  },
} as const;

/** Upgrade legacy frontmatter without discarding unknown fields. */
export function migrateFrontmatter(
  input: Record<string, FrontmatterValue | undefined>,
  now = new Date().toISOString(),
): ArticleMigrationResult {
  const rawVersion = input.schema_version;
  const fromVersion = typeof rawVersion === "number" ? rawVersion : 0;
  if (fromVersion > CONTENT_SCHEMA_VERSION)
    throw new Error(`Unsupported future schema_version: ${fromVersion}`);
  const changes: string[] = [];
  const next = { ...input };
  if (!next.slug) {
    const basis =
      typeof next.id === "string" && next.id
        ? next.id
        : typeof next.title === "string"
          ? next.title
          : "article";
    next.slug = generateSlug(basis);
    changes.push("added slug");
  }
  if (!next.version) {
    next.version = 1;
    changes.push("added version");
  }
  if (next.schema_version !== CONTENT_SCHEMA_VERSION) {
    next.schema_version = CONTENT_SCHEMA_VERSION;
    changes.push(`schema_version ${fromVersion} -> ${CONTENT_SCHEMA_VERSION}`);
  }
  const value = createDefaultFrontmatter(
    next as Partial<ArticleFrontmatter>,
    now,
  );
  return {
    value: ArticleSchema.parse(value),
    fromVersion,
    toVersion: CONTENT_SCHEMA_VERSION,
    changes,
  };
}

function isArticleStatus(value: string): value is ArticleFrontmatter["status"] {
  return [
    "idea",
    "draft",
    "reviewing",
    "reviewed",
    "approved",
    "sent_to_draft",
    "published",
    "failed",
  ].includes(value);
}

const KNOWN_ORDER = ["schema_version", ...REQUIRED_FIELDS];

export function serializeFrontmatter(
  input: Record<string, FrontmatterValue | undefined>,
  lineEnding: "\n" | "\r\n" = "\n",
): string {
  const keys = [
    ...KNOWN_ORDER.filter((key) => input[key] !== undefined),
    ...Object.keys(input)
      .filter((key) => !KNOWN_ORDER.includes(key) && input[key] !== undefined)
      .sort(),
  ];
  return keys
    .map((key) => `${key}: ${serializeValue(input[key]!)}`)
    .join(lineEnding);
}

export function serializeArticleDocument(
  document: Pick<
    ParsedArticleDocument,
    "frontmatter" | "body" | "lineEnding" | "hasBom"
  >,
): string {
  const bom = document.hasBom ? "\uFEFF" : "";
  const frontmatter = serializeFrontmatter(
    document.frontmatter,
    document.lineEnding,
  );
  if (!frontmatter) return `${bom}${document.body}`;
  return `${bom}---${document.lineEnding}${frontmatter}${document.lineEnding}---${document.lineEnding}${document.lineEnding}${document.body}`;
}

export function buildArticleDocument(
  frontmatter: Partial<ArticleFrontmatter>,
  body: string,
  options: { lineEnding?: "\n" | "\r\n"; bom?: boolean } = {},
): string {
  return serializeArticleDocument({
    frontmatter: createDefaultFrontmatter(frontmatter),
    body,
    lineEnding: options.lineEnding || "\n",
    hasBom: options.bom === true,
  });
}

export function patchArticleDocument(
  content: string,
  patch: ArticleFrontmatterPatch,
): string {
  const parsed = parseArticleDocument(content);
  const next = { ...parsed.frontmatter, ...patch };
  return serializeArticleDocument({ ...parsed, frontmatter: next });
}

export const parseMarkdownFileContent = parseArticleDocument;
export const buildMarkdownFileContent = buildArticleDocument;
