import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  concludeRuntimeLicense,
  spdxVerificationCode,
} from "./release-metadata-policy.mjs";

test("unknown and restricted runtime licenses stop SBOM generation", () => {
  for (const license of [
    undefined,
    "",
    "UNKNOWN",
    "NOASSERTION",
    "UNLICENSED",
    "AGPL-3.0",
    "LicenseRef-Source-Available",
    "GPL-3.0",
    "custom terms",
  ]) {
    assert.throws(() => concludeRuntimeLicense(license, "fixture@1.0.0"));
  }
  assert.equal(concludeRuntimeLicense("MIT", "fixture@1.0.0"), "MIT");
  assert.equal(
    concludeRuntimeLicense("(MPL-2.0 OR Apache-2.0)", "fixture@1.0.0"),
    "Apache-2.0",
  );
});

test("SPDX package verification hashes sorted SHA-1 file digests", () => {
  const first = createHash("sha1").update("first").digest("hex");
  const second = createHash("sha1").update("second").digest("hex");
  const expected = createHash("sha1")
    .update([first, second].sort().join(""))
    .digest("hex");
  assert.equal(spdxVerificationCode([second, first]), expected);
  assert.equal(spdxVerificationCode([first, second]), expected);
  assert.throws(() => spdxVerificationCode(["a".repeat(64)]));
});
