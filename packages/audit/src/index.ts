import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export interface PublishReceipt {
  article_id: string;
  account_alias: string;
  source_commit: string;
  source_hash: string;
  rendered_html_hash: string;
  assets_hash: string;
  theme: string;
  lint_report_hash: string;
  approved_by: string;
  approved_at: string;
  draft_media_id: string | null;
  created_at: string;
  result: "success" | "failed";
  error_code: string | null;
}
export const RECEIPT_FIELDS = [
  "article_id",
  "account_alias",
  "source_commit",
  "source_hash",
  "rendered_html_hash",
  "assets_hash",
  "theme",
  "lint_report_hash",
  "approved_by",
  "approved_at",
  "draft_media_id",
  "created_at",
  "result",
  "error_code",
] as const;
const SECRET_KEY =
  /(secret|token|cookie|password|credential|authorization|app.?id)/i;
const SECRET_VALUE =
  /(Bearer\s+|sk-[A-Za-z0-9]|access[_ -]?token|app[_ -]?secret|cookie\s*=|password\s*=)/i;
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, sorted(item)]),
    );
  return value;
}
export function serializeDeterministic(value: unknown): string {
  return `${JSON.stringify(sorted(value), null, 2)}\n`;
}
export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
export function assetsHash(
  assets: readonly { contentHash: string; relativePath?: string }[],
): string {
  return sha256(
    serializeDeterministic(
      assets
        .map((item) => ({
          contentHash: item.contentHash,
          relativePath: item.relativePath ?? "",
        }))
        .sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
    ),
  );
}
export interface SecretFinding {
  path: string;
  reason: "secret-key" | "secret-value";
}
export function findReceiptSecrets(
  value: unknown,
  at = "$",
  findings: SecretFinding[] = [],
): SecretFinding[] {
  if (typeof value === "string") {
    if (SECRET_VALUE.test(value))
      findings.push({ path: at, reason: "secret-value" });
  } else if (Array.isArray(value))
    value.forEach((item, index) =>
      findReceiptSecrets(item, `${at}[${index}]`, findings),
    );
  else if (value && typeof value === "object")
    for (const [key, item] of Object.entries(
      value as Record<string, unknown>,
    )) {
      const next = `${at}.${key}`;
      if (SECRET_KEY.test(key))
        findings.push({ path: next, reason: "secret-key" });
      findReceiptSecrets(item, next, findings);
    }
  return findings;
}
/** Return a safe diagnostic copy; this is for UI/log display and never for API credentials. */
export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        SECRET_KEY.test(key) ||
        (typeof item === "string" && SECRET_VALUE.test(item))
          ? "[REDACTED]"
          : redactSecrets(item),
      ]),
    );
  }
  if (typeof value === "string" && SECRET_VALUE.test(value))
    return "[REDACTED]";
  return value;
}
export function assertReceiptSafe(receipt: PublishReceipt): void {
  if (
    JSON.stringify(Object.keys(receipt).sort()) !==
    JSON.stringify([...RECEIPT_FIELDS].sort())
  )
    throw new Error("RECEIPT_FIELDS_MISMATCH");
  const findings = findReceiptSecrets(receipt);
  if (findings.length)
    throw new Error(
      `RECEIPT_CONTAINS_SECRET:${findings.map((f) => f.path).join(",")}`,
    );
}
export function serializeReceipt(receipt: PublishReceipt): string {
  assertReceiptSafe(receipt);
  return serializeDeterministic(receipt);
}
export function receiptRelativePath(slug: string, receiptId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(slug))
    throw new Error("INVALID_ARTICLE_SLUG");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(receiptId))
    throw new Error("INVALID_RECEIPT_ID");
  return path.posix.join("content", slug, "receipts", `${receiptId}.json`);
}
export async function writeReceipt(
  workspaceRoot: string,
  slug: string,
  receiptId: string,
  receipt: PublishReceipt,
): Promise<string> {
  const relative = receiptRelativePath(slug, receiptId);
  const absolute = path.resolve(workspaceRoot, ...relative.split("/"));
  const root = path.resolve(workspaceRoot);
  const check = path.relative(root, absolute);
  if (check.startsWith("..") || path.isAbsolute(check))
    throw new Error("RECEIPT_PATH_OUTSIDE_WORKSPACE");
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, serializeReceipt(receipt), {
    encoding: "utf8",
    flag: "wx",
  });
  return relative;
}
