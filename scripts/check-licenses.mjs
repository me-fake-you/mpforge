import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  findRepositoryRoot,
  isExecutedDirectly,
  printIssues,
  trackedFiles,
} from "./qa-lib.mjs";

const APPROVED_LICENSES = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
]);

const REQUIRED_EVIDENCE = Object.freeze([
  "LICENSE",
  "LICENSE_POLICY.md",
  "THIRD_PARTY_NOTICES.md",
  "third_party/SOURCE_REGISTRY.md",
  "third_party/licenses/Apache-2.0.txt",
  "apps/web/public/fonts/maple-mono/LICENSE",
  "apps/web/public/fonts/jetbrains-mono/OFL.txt",
  "apps/web/public/fonts/space-grotesk/OFL.txt",
]);

export function validatePackageMetadata(packages) {
  const issues = [];
  for (const entry of packages) {
    if (!entry.value.name || typeof entry.value.name !== "string") {
      issues.push(`${entry.path}: package name is missing`);
    }
    if (!APPROVED_LICENSES.has(entry.value.license)) {
      issues.push(
        `${entry.path}: license ${JSON.stringify(entry.value.license)} is not approved`,
      );
    }
  }
  return issues;
}

export function validateDownloadManifest(manifest) {
  const issues = [];
  if (manifest.schema_version !== 1 || !Array.isArray(manifest.entries)) {
    return ["downloads/MANIFEST.json: unsupported schema"];
  }
  const identifiers = new Set();
  for (const [index, entry] of manifest.entries.entries()) {
    const label = `downloads/MANIFEST.json entry ${index + 1}`;
    if (!entry.id || identifiers.has(entry.id)) {
      issues.push(`${label}: id is missing or duplicated`);
    }
    identifiers.add(entry.id);
    if (!entry.kind || !entry.license || !entry.local_path) {
      issues.push(`${label}: kind, license, and local_path are required`);
    }
    if (!entry.canonical_url || (!entry.version && !entry.commit)) {
      issues.push(
        `${label}: canonical_url and a version or commit are required`,
      );
    }
    if (
      path.isAbsolute(entry.local_path ?? "") ||
      (entry.local_path ?? "").split(/[\\/]/).includes("..")
    ) {
      issues.push(`${label}: local_path must stay inside the repository`);
    }
    if (!/^[A-F0-9]{64}$/.test(entry.sha256 ?? "")) {
      issues.push(
        `${label}: SHA-256 must be 64 uppercase hexadecimal characters`,
      );
    }
    if (!Number.isSafeInteger(entry.size_bytes) || entry.size_bytes <= 0) {
      issues.push(`${label}: size_bytes must be a positive safe integer`);
    }
  }
  return issues;
}

export function checkRepositoryLicenses(root) {
  const files = new Set(trackedFiles(root));
  const issues = [];
  for (const evidencePath of REQUIRED_EVIDENCE) {
    if (!files.has(evidencePath) || !existsSync(path.join(root, evidencePath)))
      issues.push(`${evidencePath}: required license evidence is missing`);
  }

  const packagePaths = [...files].filter(
    (file) =>
      (file === "package.json" || file.endsWith("/package.json")) &&
      existsSync(path.join(root, file)),
  );
  const packages = [];
  for (const file of packagePaths) {
    try {
      packages.push({
        path: file,
        value: JSON.parse(readFileSync(path.join(root, file), "utf8")),
      });
    } catch (error) {
      issues.push(`${file}: invalid package metadata (${error.message})`);
    }
  }
  issues.push(...validatePackageMetadata(packages));

  if (files.has("THIRD_PARTY_NOTICES.md")) {
    const notices = readFileSync(
      path.join(root, "THIRD_PARTY_NOTICES.md"),
      "utf8",
    );
    for (const requiredNotice of [
      "tenngoxars/WeMD",
      "MathJax",
      "Maple Mono",
      "JetBrains Mono",
      "Space Grotesk",
    ]) {
      if (!notices.includes(requiredNotice)) {
        issues.push(
          `THIRD_PARTY_NOTICES.md: missing ${requiredNotice} attribution`,
        );
      }
    }
  }

  if (files.has("third_party/SOURCE_REGISTRY.md")) {
    const registry = readFileSync(
      path.join(root, "third_party/SOURCE_REGISTRY.md"),
      "utf8",
    );
    for (const requiredSource of [
      "964525d80ef63477c3a4b0327fe2a43415ee2bad",
      "MathJax",
      "Maple Mono",
      "JetBrains Mono",
      "Space Grotesk",
    ]) {
      if (!registry.includes(requiredSource)) {
        issues.push(
          `third_party/SOURCE_REGISTRY.md: missing ${requiredSource} provenance`,
        );
      }
    }
  }

  if (files.has("downloads/MANIFEST.json")) {
    try {
      const manifest = JSON.parse(
        readFileSync(path.join(root, "downloads/MANIFEST.json"), "utf8"),
      );
      issues.push(...validateDownloadManifest(manifest));
    } catch (error) {
      issues.push(`downloads/MANIFEST.json: invalid JSON (${error.message})`);
    }
  }
  return issues.sort((left, right) => left.localeCompare(right));
}

if (isExecutedDirectly(import.meta.url)) {
  const root = findRepositoryRoot();
  process.exitCode = printIssues(
    "license check",
    checkRepositoryLicenses(root),
  );
}
