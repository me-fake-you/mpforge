import { createHash } from "node:crypto";

const allowedLicenses = new Set([
  "MIT",
  "ISC",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "BSD-4-Clause",
  "0BSD",
  "CC0-1.0",
  "CC-BY-4.0",
  "OFL-1.1",
  "Unlicense",
  "Python-2.0",
  "BlueOak-1.0.0",
]);

export function concludeRuntimeLicense(value, component) {
  // tiny-oss@0.5.1 bundles GPL-3.0-or-later vendor/digest.js despite its
  // package-level MIT label. Keep this package blocked until a separate
  // file-level license review explicitly approves a replacement version.
  if (/^(?:pkg:npm\/)?tiny-oss(?:@|$)/u.test(String(component))) {
    throw new Error(
      `Blocked bundled license conflict for ${component}: tiny-oss includes GPL-3.0-or-later vendor/digest.js; its MIT package label is insufficient`,
    );
  }
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing license evidence: ${component}`);
  }
  // These dual-license packages permit distribution under the selected option.
  const selected =
    new Map([
      ["(MPL-2.0 OR Apache-2.0)", "Apache-2.0"],
      ["(AFL-2.1 OR BSD-3-Clause)", "BSD-3-Clause"],
      ["(WTFPL OR MIT)", "MIT"],
      ["(MIT OR CC0-1.0)", "MIT"],
    ]).get(value) ?? value;
  if (!allowedLicenses.has(selected)) {
    throw new Error(`Unreviewed runtime license for ${component}: ${value}`);
  }
  return selected;
}

export function spdxVerificationCode(fileSha1s) {
  if (fileSha1s.some((digest) => !/^[a-f0-9]{40}$/u.test(digest))) {
    throw new Error("SPDX verification requires full SHA-1 file digests");
  }
  return createHash("sha1")
    .update([...fileSha1s].sort().join(""))
    .digest("hex");
}

export function requireReviewedElectronNativeDistribution(version, evidence) {
  if (
    version !== "44.2.0" ||
    evidence?.schema_version !== 1 ||
    evidence.electron_version !== version ||
    evidence.platform !== "win32-x64"
  ) {
    throw new Error("Unreviewed Electron native runtime identity");
  }
  // A pending evidence file is not a license exception. Even editing its status
  // cannot approve redistribution: source-asset verification and the explicit
  // authorization decision must be implemented before this barrier is lifted.
  throw new Error(
    "ELECTRON_NATIVE_DISTRIBUTION_BLOCKED: ffmpeg.dll is LGPL-2.1-or-later; corresponding-source redistribution authorization and same-release source/patch/build/notices verification are pending. Electron's own MIT label does not cover this native library.",
  );
}
