import type {
  LintCategory,
  LintIssue,
  LintLocation,
  LintSeverity,
} from "./types.js";

const SEVERITY_ORDER: Record<LintSeverity, number> = {
  ERROR: 0,
  WARNING: 1,
  INFO: 2,
};

export function locationAt(source: string, index: number): LintLocation {
  const before = source.slice(0, Math.max(0, index));
  const lines = before.split("\n");
  return {
    line: lines.length,
    column: (lines[lines.length - 1]?.length ?? 0) + 1,
  };
}

function excerptAt(source: string, line: number): string {
  return (source.replace(/\r\n/g, "\n").split("\n")[line - 1] ?? "")
    .trim()
    .slice(0, 240);
}

/** Small deterministic hash for diagnostic identity; not a security primitive. */
export function stableFingerprint(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first ^= code;
    first = Math.imul(first, 0x01000193) >>> 0;
    second ^= code + index;
    second = Math.imul(second, 0x85ebca6b) >>> 0;
  }
  return `${first.toString(16).padStart(8, "0")}${second
    .toString(16)
    .padStart(8, "0")}`;
}

export function diagnostic(
  ruleId: string,
  severity: LintSeverity,
  category: LintCategory,
  message: string,
  context: {
    file: string;
    source?: string;
    index?: number;
    line?: number;
    column?: number;
    excerpt?: string;
    suggestion?: string;
    autofixAvailable?: boolean;
    autofixSafe?: boolean;
    documentationKey?: string;
    legacyCode?: string;
  },
): LintIssue {
  const source = context.source ?? "";
  const inferred = locationAt(source, context.index ?? 0);
  const line = context.line ?? inferred.line;
  const column = context.column ?? inferred.column;
  const excerpt = context.excerpt ?? excerptAt(source, line);
  const autofixAvailable = context.autofixAvailable ?? false;
  const autofixSafe = autofixAvailable && (context.autofixSafe ?? false);
  const fingerprint = stableFingerprint(
    [ruleId, context.file, line, column, excerpt, message].join("\u001f"),
  );
  return {
    rule_id: ruleId,
    severity,
    category,
    message,
    file: context.file,
    line,
    column,
    excerpt,
    suggestion:
      context.suggestion ?? "Review and correct the source before approval.",
    autofix_available: autofixAvailable,
    autofix_safe: autofixSafe,
    documentation_key: context.documentationKey ?? `LINTER_RULES#${ruleId}`,
    fingerprint,
    code: context.legacyCode ?? ruleId,
    location: { line, column },
    autoFixable: autofixSafe,
  };
}

export function sortDiagnostics(issues: LintIssue[]): LintIssue[] {
  return issues.sort((a, b) => {
    const severity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (severity !== 0) return severity;
    const file = a.file.localeCompare(b.file);
    if (file !== 0) return file;
    if (a.line !== b.line) return a.line - b.line;
    if (a.column !== b.column) return a.column - b.column;
    return a.rule_id.localeCompare(b.rule_id);
  });
}

export function utf8ByteLength(value: string): number {
  if (typeof TextEncoder !== "undefined")
    return new TextEncoder().encode(value).length;
  return unescape(encodeURIComponent(value)).length;
}
