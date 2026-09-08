import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { scanText } from "./check-secrets.mjs";
import {
  DEFAULT_MAX_TRACKED_BYTES,
  validateTrackedFileSizes,
} from "./check-large-files.mjs";
import {
  validateDownloadManifest,
  validatePackageMetadata,
} from "./check-licenses.mjs";

test("secret scan reports rule and line without returning the value", () => {
  const credential = "AK" + "IA" + "A".repeat(16);
  const findings = scanText(`safe\n${credential}\n`);
  assert.deepEqual(findings, [{ rule: "aws-access-key", line: 2 }]);
  assert.equal(JSON.stringify(findings).includes(credential), false);
});

test("secret scan ignores placeholders and ordinary configuration names", () => {
  assert.deepEqual(
    scanText(
      'APP_SECRET="${MPFORGE_APP_SECRET}"\napi_key = "replace-me"\napi_key=sk-123456789012345678901234567890',
    ),
    [],
  );
});

test("secret scan catches an assigned high-entropy value", () => {
  const value = [
    "0f3c",
    "9A7b",
    "11dE",
    "82cc",
    "44F0",
    "d913",
    "aa75",
    "BC20",
  ].join("");
  assert.deepEqual(scanText(`app_secret=${value}`), [
    { rule: "assigned-secret", line: 1 },
  ]);
});

test("large-file check is deterministic and honors its exact boundary", () => {
  const issues = validateTrackedFileSizes([
    { path: "at-limit.bin", bytes: DEFAULT_MAX_TRACKED_BYTES },
    { path: "larger.bin", bytes: DEFAULT_MAX_TRACKED_BYTES + 1 },
  ]);
  assert.equal(issues.length, 1);
  assert.match(issues[0], /^larger\.bin is /);
});

test("package metadata requires an approved SPDX identifier", () => {
  assert.deepEqual(
    validatePackageMetadata([
      { path: "package.json", value: { name: "ok", license: "MIT" } },
    ]),
    [],
  );
  assert.equal(
    validatePackageMetadata([
      { path: "package.json", value: { name: "bad", license: "UNKNOWN" } },
    ]).length,
    1,
  );
});

test("download manifest rejects duplicate ids and malformed hashes", () => {
  const issues = validateDownloadManifest({
    schema_version: 1,
    entries: [
      {
        id: "same",
        kind: "archive",
        license: "MIT",
        canonical_url: "https://example.test/a.zip",
        version: "1.0.0",
        local_path: "downloads/a.zip",
        sha256: "A".repeat(64),
        size_bytes: 1,
      },
      {
        id: "same",
        kind: "archive",
        license: "MIT",
        canonical_url: "https://example.test/b.zip",
        version: "1.0.0",
        local_path: "downloads/b.zip",
        sha256: "not-a-hash",
        size_bytes: 0,
      },
    ],
  });
  assert.equal(issues.length, 3);
  assert.ok(issues.some((issue) => issue.includes("duplicated")));
  assert.ok(issues.some((issue) => issue.includes("SHA-256")));
  assert.ok(issues.some((issue) => issue.includes("size_bytes")));
});

test("format hooks exclude immutable and hash-bound evidence", () => {
  const ignore = readFileSync(
    new URL("../.prettierignore", import.meta.url),
    "utf8",
  )
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  for (const required of [
    "content/**",
    "operations/**",
    "artifacts/**",
    "reports/*.json",
  ]) {
    assert.ok(ignore.includes(required), `${required} must remain ignored`);
  }
});

test("release workflow verifies locally before any explicitly authorized publish", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/release.yml", import.meta.url),
    "utf8",
  );

  for (const required of [
    "pnpm typecheck",
    "pnpm qa",
    "node scripts/check-frontend-bundle-secrets.mjs",
    "pnpm test:e2e",
    "--publish never",
    "vars.MPFORGE_PUBLIC_RELEASE_AUTHORIZED == 'true'",
  ]) {
    assert.ok(workflow.includes(required), `${required} must remain enforced`);
  }
  assert.match(
    workflow,
    /verify-and-build-windows:[\s\S]*?permissions:\s+contents: read/u,
  );
});
