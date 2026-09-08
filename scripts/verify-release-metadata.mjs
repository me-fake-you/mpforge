import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  concludeRuntimeLicense,
  spdxVerificationCode,
} from "./release-metadata-policy.mjs";

const directory = path.resolve(process.argv[2] ?? "release");
const artifacts = path.resolve(process.argv[3] ?? directory);
const readJson = (name) =>
  JSON.parse(readFileSync(path.join(directory, name), "utf8"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const source = readJson("sbom-source.spdx.json");
const runtime = readJson("sbom-runtime.cdx.json");
const manifest = readJson("RELEASE_MANIFEST.json");
const build = readJson("BUILD_INFO.json");
const provenance = readJson("PROVENANCE.json");
if (
  !/^[a-f0-9]{40}$/u.test(manifest.source_commit ?? "") ||
  build.source_commit !== manifest.source_commit ||
  provenance.source_commit !== manifest.source_commit ||
  (process.env.GITHUB_SHA && manifest.source_commit !== process.env.GITHUB_SHA)
) {
  throw new Error("Release metadata does not identify one exact source commit");
}
const artifactNames = manifest.artifacts.map((item) => item.filename);
if (new Set(artifactNames).size !== artifactNames.length)
  throw new Error("Duplicate artifact names");
if (artifactNames.some((name) => name.startsWith("MPForge"))) {
  for (const name of [
    "MPForge.Setup.0.1.0.exe",
    "MPForge-Portable-0.1.0-win-x64.zip",
  ]) {
    if (!artifactNames.includes(name))
      throw new Error(`Missing Windows artifact: ${name}`);
  }
}
if (
  manifest.artifacts.some(
    (item) => item.source_commit !== manifest.source_commit,
  )
)
  throw new Error("Artifact source commit mismatch");
if (
  source.spdxVersion !== "SPDX-2.3" ||
  !source.files?.length ||
  !source.packages?.length
) {
  throw new Error("Source SBOM is incomplete");
}
for (const component of source.packages) {
  concludeRuntimeLicense(component.licenseConcluded, component.name);
  if (component.name === "@wemd/server")
    throw new Error("Excluded server in source SBOM");
  if (
    component.filesAnalyzed &&
    !/^[0-9a-f]{40}$/u.test(
      component.packageVerificationCode?.packageVerificationCodeValue ?? "",
    )
  ) {
    throw new Error("Source SBOM package verification code is invalid");
  }
}
for (const file of source.files) {
  concludeRuntimeLicense(file.licenseConcluded, file.fileName);
  if (/(?:^|\/)apps\/server\//u.test(file.fileName))
    throw new Error("Excluded server source file in SBOM");
  if (
    !/^[a-f0-9]{64}$/u.test(
      file.checksums?.find((item) => item.algorithm === "SHA256")
        ?.checksumValue ?? "",
    )
  ) {
    throw new Error(`Invalid source digest: ${file.fileName}`);
  }
}
if (
  new Set(source.files.map((file) => file.fileName)).size !==
  source.files.length
)
  throw new Error("Duplicate source file");
const verificationCode = spdxVerificationCode(
  source.files.map(
    (file) =>
      file.checksums?.find((item) => item.algorithm === "SHA1")
        ?.checksumValue ?? "",
  ),
);
for (const component of source.packages.filter((item) => item.filesAnalyzed)) {
  if (
    component.packageVerificationCode.packageVerificationCodeValue !==
    verificationCode
  )
    throw new Error("Source package verification digest mismatch");
}
if (runtime.bomFormat !== "CycloneDX" || !runtime.components?.length)
  throw new Error("Runtime SBOM is empty");
for (const component of runtime.components) {
  if (component.name === "@wemd/server")
    throw new Error("Excluded server in runtime SBOM");
  if (component.licenses?.length !== 1)
    throw new Error(`Missing license conclusion: ${component.name}`);
  concludeRuntimeLicense(component.licenses[0].expression, component.name);
}
const expected = new Set([
  "BUILD_INFO.json",
  "PROVENANCE.json",
  "RELEASE_MANIFEST.json",
  "sbom-source.spdx.json",
  "sbom-runtime.cdx.json",
]);
for (const item of manifest.artifacts) expected.add(item.filename);
const checked = new Set();
for (const line of readFileSync(path.join(directory, "SHA256SUMS"), "utf8")
  .trim()
  .split(/\r?\n/u)) {
  const match = /^([0-9a-f]{64})  ([A-Za-z0-9_.-]+)$/u.exec(line);
  if (!match || checked.has(match[2]) || !expected.has(match[2]))
    throw new Error("Unexpected checksum entry");
  const [, digest, name] = match;
  const bytes = readFileSync(
    path.join(name.startsWith("MPForge") ? artifacts : directory, name),
  );
  if (sha256(bytes) !== digest) throw new Error(`Checksum mismatch: ${name}`);
  const item = manifest.artifacts.find((entry) => entry.filename === name);
  if (item && (item.sha256 !== digest || item.size !== bytes.length))
    throw new Error(`Manifest mismatch: ${name}`);
  checked.add(name);
}
if (checked.size !== expected.size)
  throw new Error("Incomplete checksum manifest");
console.log(
  JSON.stringify({
    summary: "PASS",
    source_files: source.files.length,
    runtime_components: runtime.components.length,
    checksums: checked.size,
  }),
);
