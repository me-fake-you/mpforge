import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  concludeRuntimeLicense,
  spdxVerificationCode,
  requireReviewedElectronNativeDistribution,
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

test("Electron native distribution stays blocked until source redistribution and review are implemented", () => {
  const evidence = {
    schema_version: 1,
    electron_version: "44.2.0",
    platform: "win32-x64",
    review_status: "PENDING_USER_SOURCE_ATTACHMENT_AUTHORIZATION",
  };
  assert.throws(
    () => requireReviewedElectronNativeDistribution("44.2.0", evidence),
    /ELECTRON_NATIVE_DISTRIBUTION_BLOCKED/,
  );
  assert.throws(
    () =>
      requireReviewedElectronNativeDistribution("44.2.0", {
        ...evidence,
        review_status: "APPROVED",
        distribution_obligations_complete: true,
      }),
    /ELECTRON_NATIVE_DISTRIBUTION_BLOCKED/,
  );
  assert.throws(
    () => requireReviewedElectronNativeDistribution("45.0.0", evidence),
    /Unreviewed/,
  );
  assert.throws(
    () => requireReviewedElectronNativeDistribution("44.2.0", null),
    /Unreviewed/,
  );
  assert.throws(() =>
    concludeRuntimeLicense("LGPL-2.1-or-later", "unrelated-native-library"),
  );
});

test("bundled GPL evidence blocks tiny-oss even when package metadata declares MIT", () => {
  for (const component of [
    "tiny-oss",
    "tiny-oss@0.5.1",
    "pkg:npm/tiny-oss@0.5.1",
  ]) {
    assert.throws(
      () => concludeRuntimeLicense("MIT", component),
      /Blocked bundled license conflict.*GPL-3.0-or-later/,
    );
  }
  // A changed version number cannot silently bypass the file-review gate.
  assert.throws(() => concludeRuntimeLicense("MIT", "tiny-oss@99.0.0"));
  assert.equal(concludeRuntimeLicense("MIT", "unrelated-library@1.0.0"), "MIT");
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
