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
