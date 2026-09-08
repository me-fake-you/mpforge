import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  deniedSourcePathReasons,
  isSourcePathAllowed,
  loadPublicPolicies,
} from "./audit-public-boundary.mjs";
import {
  concludeRuntimeLicense,
  spdxVerificationCode,
} from "./release-metadata-policy.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function localDirectoryOption(flag, fallback) {
  const index = process.argv.indexOf(flag);
  if (
    index >= 0 &&
    (!process.argv[index + 1] || process.argv[index + 1].startsWith("--"))
  ) {
    throw new Error(`Missing path for ${flag}`);
  }
  const destination = path.resolve(
    root,
    index < 0 ? fallback : process.argv[index + 1],
  );
  const relative = path.relative(root, destination);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`${flag} must stay inside the project`);
  }
  return destination;
}
const releaseDirectory = localDirectoryOption("--output-dir", "release");
const artifactDirectory = localDirectoryOption(
  "--artifact-dir",
  "artifacts/public-v0.1.0",
);
mkdirSync(releaseDirectory, { recursive: true });
const version = "0.1.0";
const created = new Date().toISOString();
const verified = process.argv.includes("--verified");
const includeWindowsArtifacts = process.argv.includes("--with-artifacts");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const writeJson = (name, value) =>
  writeFileSync(
    path.join(releaseDirectory, name),
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );
const git = (args) =>
  execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 128 * 1024 * 1024,
  }).trim();

const licenseOverrides = new Map([
  ["css-select@1.2.0", "BSD-2-Clause"],
  ["domutils@1.5.1", "BSD-2-Clause"],
  ["dompurify@3.3.1", "Apache-2.0"],
  ["khroma@2.1.0", "MIT"],
  ["json-schema@0.4.0", "BSD-3-Clause"],
  ["match-at@0.1.1", "MIT"],
  ["spark-md5@3.0.2", "MIT"],
  ["slick@1.12.2", "MIT"],
]);

function packageId(name, versionInfo) {
  return `SPDXRef-Package-${`${name}-${versionInfo}`.replace(/[^A-Za-z0-9.-]/gu, "-")}`;
}

function fileId(relativePath) {
  return `SPDXRef-File-${sha256(relativePath).slice(0, 24)}`;
}

function sourceFileLicense(relativePath) {
  const normalized = relativePath.replaceAll("\\", "/").toLowerCase();
  if (
    normalized.startsWith("apps/web/public/fonts/maple-mono/") ||
    normalized.startsWith("apps/web/public/fonts/jetbrains-mono/") ||
    normalized.startsWith("apps/web/public/fonts/space-grotesk/")
  ) {
    return "OFL-1.1";
  }
  if (
    normalized === "apps/web/public/libs/mathjax/tex-svg.js" ||
    normalized === "third_party/licenses/apache-2.0.txt"
  ) {
    return "Apache-2.0";
  }
  return "MIT";
}

function trackedPublicFiles() {
  const { allowlist, denylist } = loadPublicPolicies(root);
  return git(["ls-files", "-z"])
    .split("\0")
    .filter(Boolean)
    .map((entry) => entry.replaceAll("\\", "/"))
    .filter(
      (entry) =>
        !/^release\/(?:sbom-.*\.json|BUILD_INFO\.json|PROVENANCE\.json|RELEASE_MANIFEST\.json|SHA256SUMS)$/u.test(
          entry,
        ) &&
        isSourcePathAllowed(entry, allowlist) &&
        deniedSourcePathReasons(entry, denylist).length === 0 &&
        existsSync(path.join(root, entry)) &&
        statSync(path.join(root, entry)).isFile(),
    )
    .sort();
}

function committedSourceBytes(publicFiles) {
  if (git(["status", "--porcelain=v1", "--untracked-files=no"])) {
    throw new Error("Release metadata requires a clean committed source tree");
  }
  const bytes = execFileSync("git", ["-C", root, "cat-file", "--batch"], {
    input: publicFiles.map((file) => `HEAD:${file}\n`).join(""),
    maxBuffer: 128 * 1024 * 1024,
    windowsHide: true,
  });
  const sources = new Map();
  let offset = 0;
  for (const file of publicFiles) {
    const end = bytes.indexOf(10, offset);
    const header = bytes.subarray(offset, end).toString("utf8");
    const match = /^[a-f0-9]+ blob (\d+)$/u.exec(header);
    if (!match) throw new Error(`Missing committed source blob: ${file}`);
    const size = Number(match[1]);
    offset = end + 1;
    sources.set(file, bytes.subarray(offset, offset + size));
    offset += size + 1;
  }
  return sources;
}

function sourcePackages(publicFiles, sources) {
  return publicFiles
    .filter((file) => file === "package.json" || file.endsWith("/package.json"))
    .map((file) => {
      const manifest = JSON.parse(sources.get(file).toString("utf8"));
      if (!manifest.name || !manifest.license) {
        throw new Error(`Incomplete package name/license metadata: ${file}`);
      }
      return {
        name: manifest.name,
        SPDXID: packageId(manifest.name, manifest.version ?? version),
        versionInfo: manifest.version ?? version,
        downloadLocation: "NONE",
        filesAnalyzed: false,
        licenseConcluded: concludeRuntimeLicense(
          manifest.license,
          manifest.name,
        ),
        licenseDeclared: manifest.license,
        copyrightText:
          "Copyright MPForge contributors, WeMD Team, and respective upstream authors",
        externalRefs: [
          {
            referenceCategory: "PACKAGE-MANAGER",
            referenceType: "purl",
            referenceLocator: `pkg:npm/${encodeURIComponent(manifest.name).replace("%2F", "/")}@${manifest.version ?? version}`,
          },
        ],
      };
    });
}

function createSourceSbom() {
  const publicFiles = trackedPublicFiles();
  // Git blobs are canonical: Windows checkout line endings must not alter the SBOM.
  const sources = committedSourceBytes(publicFiles);
  const packages = sourcePackages(publicFiles, sources);
  const files = publicFiles.map((relativePath) => {
    const license = sourceFileLicense(relativePath);
    return {
      fileName: `./${relativePath}`,
      SPDXID: fileId(relativePath),
      checksums: [
        {
          algorithm: "SHA1",
          checksumValue: createHash("sha1")
            .update(sources.get(relativePath))
            .digest("hex"),
        },
        {
          algorithm: "SHA256",
          checksumValue: sha256(sources.get(relativePath)),
        },
      ],
      licenseConcluded: license,
      licenseInfoInFiles: [license],
      copyrightText:
        "See NOTICE.md, THIRD_PARTY_NOTICES.md, and file-level license evidence",
    };
  });
  const documentId = "SPDXRef-Package-MPForge-source";
  return {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: `MPForge-source-${version}`,
    documentNamespace: `https://github.com/me-fake-you/mpforge/spdx/${version}/${randomUUID()}`,
    creationInfo: {
      created,
      creators: ["Tool: MPForge generate-release-metadata.mjs"],
      licenseListVersion: "3.25",
    },
    documentDescribes: [documentId],
    packages: [
      {
        name: "MPForge source distribution",
        SPDXID: documentId,
        versionInfo: version,
        downloadLocation: "NONE",
        filesAnalyzed: true,
        packageVerificationCode: {
          packageVerificationCodeValue: spdxVerificationCode(
            publicFiles.map((file) =>
              createHash("sha1").update(sources.get(file)).digest("hex"),
            ),
          ),
        },
        licenseConcluded: "MIT",
        licenseDeclared: "MIT",
        licenseInfoFromFiles: [
          ...new Set(files.map((file) => file.licenseConcluded)),
        ].sort(),
        copyrightText:
          "Copyright WeMD Team and MPForge contributors; see NOTICE.md",
      },
      ...packages,
    ],
    files,
    relationships: [
      ...files.map((file) => ({
        spdxElementId: documentId,
        relationshipType: "CONTAINS",
        relatedSpdxElement: file.SPDXID,
      })),
      ...packages.map((component) => ({
        spdxElementId: documentId,
        relationshipType: "CONTAINS",
        relatedSpdxElement: component.SPDXID,
      })),
    ],
  };
}

function installedLicenseIndex() {
  const store = path.join(root, "node_modules", ".pnpm");
  const index = new Map();
  if (!existsSync(store)) return index;
  for (const entry of readdirSync(store, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const modules = path.join(store, entry.name, "node_modules");
    if (!existsSync(modules)) continue;
    for (const name of readdirSync(modules)) {
      if (name.startsWith(".")) continue;
      const candidate = path.join(modules, name);
      const packageDirectories = name.startsWith("@")
        ? readdirSync(candidate).map((child) => path.join(candidate, child))
        : [candidate];
      for (const packageDirectory of packageDirectories) {
        const manifestPath = path.join(packageDirectory, "package.json");
        if (!existsSync(manifestPath)) continue;
        try {
          const manifest = readJson(manifestPath);
          if (manifest.name && manifest.version) {
            index.set(`${manifest.name}@${manifest.version}`, manifest.license);
          }
        } catch {
          // Invalid dependency metadata will be caught when a reachable package is read.
        }
      }
    }
  }
  return index;
}

function createRuntimeSbom() {
  const pnpmArguments = [
    "list",
    "--prod",
    "--json",
    "-r",
    "--depth",
    "Infinity",
  ];
  const command =
    process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : "pnpm";
  const commandArguments =
    process.platform === "win32"
      ? ["/d", "/s", "/c", "pnpm", ...pnpmArguments]
      : pnpmArguments;
  const list = JSON.parse(
    execFileSync(command, commandArguments, {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 128 * 1024 * 1024,
    }),
  );
  const licenses = installedLicenseIndex();
  const components = new Map();
  const visit = (dependencies) => {
    if (!dependencies || typeof dependencies !== "object") return;
    for (const [name, node] of Object.entries(dependencies)) {
      const rawVersion = String(node?.version ?? "");
      if (!rawVersion || /^(?:link|workspace):/u.test(rawVersion)) {
        visit(node?.dependencies);
        continue;
      }
      const key = `${name}@${rawVersion}`;
      const concluded = concludeRuntimeLicense(
        licenseOverrides.get(key) ?? licenses.get(key),
        key,
      );
      if (!components.has(key)) {
        components.set(key, {
          type: "library",
          "bom-ref": `pkg:npm/${encodeURIComponent(name).replace("%2F", "/")}@${rawVersion}`,
          name,
          version: rawVersion,
          licenses: [{ expression: concluded }],
          purl: `pkg:npm/${encodeURIComponent(name).replace("%2F", "/")}@${rawVersion}`,
        });
      }
      visit(node?.dependencies);
    }
  };
  for (const tree of list) visit(tree.dependencies);
  // Electron is a build-time npm dependency but a distributed runtime.
  // Chromium's bundled notices are retained by electron-builder.
  const electronManifestPath = path.join(
    root,
    "apps/electron/node_modules/electron/package.json",
  );
  if (includeWindowsArtifacts) {
    if (!existsSync(electronManifestPath))
      throw new Error("Electron runtime license metadata is missing");
    const electron = readJson(electronManifestPath);
    const purl = `pkg:npm/electron@${electron.version}`;
    components.set(`electron@${electron.version}`, {
      type: "framework",
      "bom-ref": purl,
      name: "electron",
      version: electron.version,
      purl,
      licenses: [
        { expression: concludeRuntimeLicense(electron.license, purl) },
      ],
    });
  }
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    serialNumber: `urn:uuid:${randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: created,
      tools: {
        components: [
          {
            type: "application",
            name: "MPForge release metadata generator",
            version,
          },
        ],
      },
      component: { type: "application", name: "MPForge", version },
    },
    components: [...components.values()].sort((left, right) =>
      left.purl.localeCompare(right.purl),
    ),
  };
}

const commit = git(["rev-parse", "HEAD"]);
writeJson("sbom-source.spdx.json", createSourceSbom());
writeJson("sbom-runtime.cdx.json", createRuntimeSbom());
writeJson("BUILD_INFO.json", {
  schema_version: 1,
  version,
  source_commit: commit,
  generated_at: created,
  build_platform: `${process.platform}-${process.arch}`,
  signed: false,
  reproducible: false,
  status: verified ? "RELEASE_READY_METADATA" : "SOURCE_CANDIDATE_METADATA",
});
writeJson("PROVENANCE.json", {
  schema_version: 1,
  subject: `MPForge v${version} ${includeWindowsArtifacts ? "release artifacts" : "source candidate"}`,
  source_commit: commit,
  upstream: {
    repository: "https://github.com/tenngoxars/WeMD",
    commit: "964525d80ef63477c3a4b0327fe2a43415ee2bad",
    license: "MIT",
  },
  history_strategy: "clean-source",
  excluded: [
    "apps/server",
    "content",
    "operations",
    "local caches, toolchains, archives, profiles, and receipts",
  ],
  live_account_tested: false,
  formal_publish_supported: false,
  mass_send_supported: false,
});

const metadataNames = [
  "BUILD_INFO.json",
  "PROVENANCE.json",
  "sbom-runtime.cdx.json",
  "sbom-source.spdx.json",
];
const windowsArtifactNames = [
  "MPForge.Setup.0.1.0.exe",
  "MPForge-Portable-0.1.0-win-x64.zip",
];
if (includeWindowsArtifacts) {
  for (const name of windowsArtifactNames) {
    if (!existsSync(path.join(artifactDirectory, name))) {
      throw new Error(`Required Windows release artifact is missing: ${name}`);
    }
  }
}
const releaseArtifactNames = includeWindowsArtifacts
  ? [...metadataNames, ...windowsArtifactNames]
  : metadataNames;
const artifactPath = (name) =>
  windowsArtifactNames.includes(name)
    ? path.join(artifactDirectory, name)
    : path.join(releaseDirectory, name);
const artifacts = releaseArtifactNames.map((name) => {
  const buffer = readFileSync(artifactPath(name));
  return {
    filename: name,
    version,
    source_commit: commit,
    build_platform: windowsArtifactNames.includes(name)
      ? "windows-x64"
      : "platform-independent",
    build_time: created,
    sha256: sha256(buffer),
    size: buffer.length,
    signed: false,
    sbom: ["sbom-source.spdx.json", "sbom-runtime.cdx.json"],
    public_boundary_verified: verified,
    secret_scan_verified: verified,
    license_scan_verified: verified,
  };
});
writeJson("RELEASE_MANIFEST.json", {
  schema_version: 1,
  release: `v${version}`,
  source_commit: commit,
  candidate_only: !verified,
  release_ready: verified,
  public_release_created: false,
  reproducible: false,
  artifacts,
});

const checksumNames = [...releaseArtifactNames, "RELEASE_MANIFEST.json"].sort();
writeFileSync(
  path.join(releaseDirectory, "SHA256SUMS"),
  `${checksumNames
    .map((name) => `${sha256(readFileSync(artifactPath(name)))}  ${name}`)
    .join("\n")}\n`,
  "utf8",
);

process.stdout.write(
  `${JSON.stringify({
    version,
    source_commit: commit,
    source_files: trackedPublicFiles().length,
    runtime_components: readJson(
      path.join(releaseDirectory, "sbom-runtime.cdx.json"),
    ).components.length,
    outputs: [
      ...metadataNames,
      ...(includeWindowsArtifacts ? windowsArtifactNames : []),
      "RELEASE_MANIFEST.json",
      "SHA256SUMS",
    ],
  })}\n`,
);
