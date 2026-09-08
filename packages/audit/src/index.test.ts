import { describe, expect, it } from "vitest";
import {
  assertReceiptSafe,
  receiptRelativePath,
  redactSecrets,
  serializeDeterministic,
  serializeReceipt,
  type PublishReceipt,
} from "./index.js";
const receipt = (): PublishReceipt => ({
  article_id: "demo",
  account_alias: "official",
  source_commit: "abc",
  source_hash: "a",
  rendered_html_hash: "b",
  assets_hash: "c",
  theme: "minimal",
  lint_report_hash: "d",
  approved_by: "human",
  approved_at: "2026-08-31T00:00:00Z",
  draft_media_id: "media-1",
  created_at: "2026-08-31T00:00:01Z",
  result: "success",
  error_code: null,
});
describe("publish receipts", () => {
  it("serializes deterministically", () =>
    expect(serializeDeterministic({ z: 1, a: { d: 2, c: 1 } })).toBe(
      serializeDeterministic({ a: { c: 1, d: 2 }, z: 1 }),
    ));
  it("uses content receipt path", () =>
    expect(receiptRelativePath("demo", "r-1")).toBe(
      "content/demo/receipts/r-1.json",
    ));
  it("rejects secrets and extra fields", () => {
    expect(() =>
      assertReceiptSafe({
        ...receipt(),
        access_token: "Bearer secret",
      } as never),
    ).toThrow("RECEIPT_FIELDS_MISMATCH");
    expect(() =>
      assertReceiptSafe({ ...receipt(), account_alias: "access_token=secret" }),
    ).toThrow("RECEIPT_CONTAINS_SECRET");
  });
  it("redacts secret diagnostics", () =>
    expect(
      redactSecrets({
        appSecret: "private",
        nested: { authorization: "Bearer abc" },
        ok: "value",
      }),
    ).toEqual({
      appSecret: "[REDACTED]",
      nested: { authorization: "[REDACTED]" },
      ok: "value",
    }));
  it("keeps exact field contract", () =>
    expect(() => serializeReceipt(receipt())).not.toThrow());
});
