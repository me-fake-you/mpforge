import path from "node:path";
import { DraftOperationError } from "./errors.js";

const SENSITIVE_KEY =
  /(?:^|_)(?:app_?secret|access_?token|cookie|authorization|password|private_?key|credential)(?:$|_)/iu;
const SENSITIVE_VALUE =
  /(?:bearer\s+[a-z0-9._~+/=-]+|access[_ -]?token\s*[=:]|app[_ -]?secret\s*[=:]|cookie\s*[=:]|password\s*[=:]|-----begin [a-z ]*private key-----)/iu;

export function assertSafeSegment(value: string, label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value))
    throw new DraftOperationError(
      "INVALID_OPERATION_ID",
      `${label} is not a safe path segment`,
      { label },
    );
}

export function resolveInside(
  parent: string,
  candidate: string,
  label: string,
): string {
  const root = path.resolve(parent);
  const absolute = path.resolve(candidate);
  const relative = path.relative(root, absolute);
  if (!relative || (!relative.startsWith("..") && !path.isAbsolute(relative)))
    return absolute;
  throw new DraftOperationError(
    "PATH_OUTSIDE_WORKSPACE",
    `${label} must remain under the configured root`,
    { label },
  );
}

export function resolveChild(parent: string, relativePath: string): string {
  if (path.isAbsolute(relativePath))
    throw new DraftOperationError(
      "PATH_OUTSIDE_WORKSPACE",
      "Snapshot source paths must be relative",
    );
  return resolveInside(
    parent,
    path.resolve(parent, relativePath),
    relativePath,
  );
}

function stripUrlDetails(value: string): string {
  if (!/^https?:\/\//iu.test(value)) return value;
  try {
    const parsed = new URL(value);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "[REDACTED_URL]";
  }
}

/** Remove rather than partially display secrets; query strings are never persisted. */
export function sanitizeForStorage(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeForStorage);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !SENSITIVE_KEY.test(key))
        .map(([key, item]) => [key, sanitizeForStorage(item)]),
    );
  if (typeof value === "string") {
    if (SENSITIVE_VALUE.test(value)) return "[REDACTED]";
    return stripUrlDetails(value);
  }
  return value;
}

export function assertNoSensitiveOutput(value: unknown): void {
  const findings: string[] = [];
  function visit(input: unknown, at: string): void {
    if (Array.isArray(input)) {
      input.forEach((item, index) => visit(item, `${at}[${index}]`));
      return;
    }
    if (input && typeof input === "object") {
      for (const [key, item] of Object.entries(
        input as Record<string, unknown>,
      )) {
        if (SENSITIVE_KEY.test(key)) findings.push(`${at}.${key}`);
        visit(item, `${at}.${key}`);
      }
      return;
    }
    if (typeof input === "string" && SENSITIVE_VALUE.test(input))
      findings.push(at);
  }
  visit(value, "$");
  if (findings.length)
    throw new DraftOperationError(
      "SENSITIVE_OUTPUT_REJECTED",
      "Persisted operation output contains sensitive material",
      { paths: findings },
    );
}
