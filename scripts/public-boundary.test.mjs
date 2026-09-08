import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  auditArtifactDirectory,
  auditExportInventory,
  auditPublicBoundary,
  auditReadmeLinks,
  auditWebDist,
  deniedSourcePathReasons,
  dockerContextIncludes,
  isSourcePathAllowed,
  loadPublicPolicies,
  portablePublicReport,
  repositoryRoot,
  validateSourceBuffer,
} from "./audit-public-boundary.mjs";
import {
  buildPublicSource,
  publicStagingPath,
} from "./build-public-source.mjs";
import { scanPublicHistory } from "./scan-public-history.mjs";

const policies = loadPublicPolicies(repositoryRoot);
const testRoot = path.join(repositoryRoot, "tmp");

test("portable public reports never serialize the local repository path", () => {
  const report = portablePublicReport(
    {
      root: repositoryRoot,
      nested: {
        target: path.join(repositoryRoot, "apps", "web", "dist"),
        url: "https://github.com/me-fake-you/mpforge",
      },
    },
    repositoryRoot,
  );
  const serialized = JSON.stringify(report);
  assert.equal(report.root, ".");
  assert.equal(report.nested.target, "apps/web/dist");
  assert.equal(report.nested.url, "https://github.com/me-fake-you/mpforge");
  assert.equal(serialized.includes(repositoryRoot), false);
});

function runGit(root, arguments_, options = {}) {
  return execFileSync("git", ["-C", root, ...arguments_], {
    encoding: "utf8",
    input: options.input,
    windowsHide: true,
  }).trim();
}

function write(root, relativePath, value) {
  const destination = path.join(root, ...relativePath.split("/"));
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, value, "utf8");
}

function initializeRepository() {
  mkdirSync(testRoot, { recursive: true });
  const root = mkdtempSync(path.join(testRoot, "public-boundary-test-"));
  runGit(root, ["init", "-b", "main"]);
  runGit(root, ["config", "user.name", "MPForge Test"]);
  runGit(root, ["config", "user.email", "mpforge-tests@example.com"]);
  runGit(root, ["config", "core.autocrlf", "false"]);
  const files = {
    LICENSE: "MIT License\n",
    "UPSTREAM.md": "Based on WeMD at the pinned upstream commit.\n",
    "THIRD_PARTY_NOTICES.md": "WeMD attribution.\n",
    "LICENSE_POLICY.md": "Only approved SPDX licenses are distributed.\n",
    "SECURITY.md": "Report security issues without posting credentials.\n",
    "CONTRIBUTING.md": "Use mock-only tests.\n",
    "README.md": "# MPForge\n",
    "package.json": `${JSON.stringify({ name: "mpforge-test", private: true, license: "MIT" }, null, 2)}\n`,
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\nimporters:\n  .: {}\n",
    "pnpm-workspace.yaml": "packages: []\n",
  };
  for (const [relativePath, value] of Object.entries(files))
    write(root, relativePath, value);
  runGit(root, ["add", "."]);
  runGit(root, ["commit", "-m", "test: public source fixture"]);
  return root;
}

function withRepository(callback) {
  const root = initializeRepository();
  try {
    return callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("public source policy is default-deny with hard local-data exclusions", () => {
  assert.equal(
    isSourcePathAllowed("apps/web/src/App.tsx", policies.allowlist),
    true,
  );
  assert.equal(
    isSourcePathAllowed("private/random.txt", policies.allowlist),
    false,
  );
  assert.ok(
    deniedSourcePathReasons("apps/server/src/main.ts", policies.denylist)
      .length > 0,
  );
  assert.ok(
    deniedSourcePathReasons("downloads/wemd-upstream.bundle", policies.denylist)
      .length > 0,
  );
  assert.deepEqual(
    deniedSourcePathReasons(
      "downloads/MANIFEST.public.json",
      policies.denylist,
    ),
    [],
  );
});

test("Docker context evaluation honors ordered default-deny exceptions", () => {
  const dockerignore = "**\n!package.json\n!apps/web/**\n";
  assert.equal(
    dockerContextIncludes("operations/receipt.json", dockerignore),
    false,
  );
  assert.equal(dockerContextIncludes("package.json", dockerignore), true);
  assert.equal(
    dockerContextIncludes("apps/web/src/App.tsx", dockerignore),
    true,
  );
});

test("source maps and embedded private paths fail source validation", () => {
  const sourceMap = Buffer.from(
    JSON.stringify({
      version: 3,
      sources: ["C:/Users/example/private.ts"],
      mappings: "",
    }),
  );
  const findings = validateSourceBuffer(
    "apps/web/public/app.js.map",
    sourceMap,
    policies,
  );
  assert.ok(findings.some((finding) => finding.rule === "deny-path"));
});

test("public source export reads a clean specified commit into the fixed staging path", () =>
  withRepository((root) => {
    const commit = runGit(root, ["rev-parse", "HEAD"]);
    const report = buildPublicSource({ root, commit, policies });
    assert.equal(report.staging, publicStagingPath(root));
    assert.equal(existsSync(path.join(report.staging, ".git")), false);
    assert.equal(
      readFileSync(path.join(report.staging, "README.md"), "utf8"),
      "# MPForge\n",
    );
    const manifest = JSON.parse(
      readFileSync(
        path.join(report.staging, "release", "public-release-manifest.json"),
        "utf8",
      ),
    );
    assert.equal(manifest.generated, true);
    assert.equal(manifest.source_commit, commit);
    assert.ok(
      manifest.files.every((entry) => !entry.path.startsWith("operations/")),
    );
    runGit(report.staging, ["init", "-b", "main"]);
    runGit(report.staging, ["config", "user.name", "MPForge Test"]);
    runGit(report.staging, [
      "config",
      "user.email",
      "mpforge-tests@example.com",
    ]);
    runGit(report.staging, ["add", "."]);
    runGit(report.staging, ["commit", "-m", "test: clean public source"]);
    const boundary = auditPublicBoundary({ root: report.staging, policies });
    assert.equal(
      boundary.checks.find((check) => check.id === "public-staging").status,
      "PASS",
    );
  }));

test("public source export rejects a dirty input worktree", () =>
  withRepository((root) => {
    write(root, "untracked.txt", "not committed\n");
    assert.throws(
      () => buildPublicSource({ root, commit: "HEAD", policies }),
      /dirty Git worktree/u,
    );
  }));

test("export inventory rejects ignored evidence even when it exists on disk", () =>
  withRepository((root) => {
    const image = "safe synthetic evidence\n";
    write(root, ".gitignore", "artifacts/\n");
    write(root, "artifacts/evidence/round-4/dashboard.png", image);
    write(
      root,
      "release/public-release-manifest.json",
      JSON.stringify({
        generated: true,
        files: [
          {
            path: "artifacts/evidence/round-4/dashboard.png",
            sha256: createHash("sha256").update(image).digest("hex"),
            size: Buffer.byteLength(image),
          },
        ],
      }),
    );
    runGit(root, ["add", "."]);
    const report = auditExportInventory(root);
    assert.equal(report.status, "FAIL");
    assert.equal(report.findings[0].rule, "export-file-untracked");
    runGit(root, ["add", "-f", "artifacts/evidence/round-4/dashboard.png"]);
    assert.equal(auditExportInventory(root).status, "PASS");
    rmSync(path.join(root, "artifacts/evidence/round-4/dashboard.png"));
    assert.equal(
      auditExportInventory(root).findings[0].rule,
      "export-file-missing",
    );
  }));

test("export baseline permits maintained files and additional release metadata", () =>
  withRepository((root) => {
    const original = readFileSync(path.join(root, "README.md"));
    write(
      root,
      "release/public-release-manifest.json",
      JSON.stringify({
        generated: true,
        files: [
          {
            path: "README.md",
            sha256: createHash("sha256").update(original).digest("hex"),
            size: original.length,
          },
        ],
      }),
    );
    write(root, "README.md", "# Updated public documentation\n");
    write(root, "release/BUILD_INFO.json", "{}\n");
    runGit(root, ["add", "."]);
    assert.equal(auditExportInventory(root).status, "PASS");
    write(
      root,
      "release/public-release-manifest.json",
      JSON.stringify({ generated: false, files: [] }),
    );
    assert.equal(auditExportInventory(root).status, "PASS");
    write(
      root,
      "release/public-release-manifest.json",
      JSON.stringify({ generated: true, files: [{ path: "../outside" }] }),
    );
    assert.equal(
      auditExportInventory(root).findings[0].rule,
      "invalid-export-entry",
    );
  }));

test("README links require local images and documents in the Git index", () =>
  withRepository((root) => {
    write(root, ".gitignore", "artifacts/\n");
    write(root, "artifacts/evidence/round-4/dashboard.png", "image\n");
    write(
      root,
      "README.md",
      [
        "![Dashboard](artifacts/evidence/round-4/dashboard.png)",
        "[Missing document](docs/missing.md#anchor)",
        "[Remote](https://example.com/missing)",
        "[Anchor](#heading)",
        "```markdown",
        "[Code example](missing-example.md)",
        "```",
        "`[Inline example](another-missing.md)`",
      ].join("\n"),
    );
    runGit(root, ["add", "."]);
    const report = auditReadmeLinks(root);
    assert.equal(report.status, "FAIL");
    assert.equal(report.checked_local_targets, 2);
    assert.equal(report.findings.length, 2);
    runGit(root, ["add", "-f", "artifacts/evidence/round-4/dashboard.png"]);
    write(root, "docs/missing.md", "# Now present\n");
    runGit(root, ["add", "docs/missing.md"]);
    assert.equal(auditReadmeLinks(root).status, "PASS");
  }));

test("README references, HTML assets, encoded paths and directories resolve locally", () =>
  withRepository((root) => {
    write(root, "docs/space name.md", "# Document\n");
    write(root, "docs/image.png", "image\n");
    write(
      root,
      "README.en.md",
      [
        "[Reference][guide]",
        '[guide]: <docs/space name.md> "Guide"',
        "[Encoded](docs/space%20name.md#document)",
        "[Directory](docs/)",
        '<img src="docs/image.png" alt="example">',
        '<a href="docs/space%20name.md">Guide</a>',
      ].join("\n"),
    );
    runGit(root, ["add", "."]);
    const report = auditReadmeLinks(root);
    assert.equal(report.status, "PASS");
    assert.equal(report.checked_local_targets, 5);
    write(root, "README.en.md", "[Escape](%2e%2e/outside.md)\n");
    assert.equal(
      auditReadmeLinks(root).findings[0].rule,
      "readme-unsafe-local-link",
    );
  }));

test("public source export rejects a stale apps/server lock importer", () =>
  withRepository((root) => {
    write(
      root,
      "pnpm-lock.yaml",
      "lockfileVersion: '9.0'\nimporters:\n  .: {}\n  apps/server:\n    dependencies: {}\n",
    );
    runGit(root, ["add", "pnpm-lock.yaml"]);
    runGit(root, ["commit", "-m", "test: stale importer"]);
    assert.throws(
      () => buildPublicSource({ root, commit: "HEAD", policies }),
      /apps\/server workspace importer/u,
    );
  }));

test("public source export rejects a commit that still contains apps/server", () =>
  withRepository((root) => {
    write(
      root,
      "apps/server/main.ts",
      "export const inheritedServer = true;\n",
    );
    runGit(root, ["add", "apps/server/main.ts"]);
    runGit(root, ["commit", "-m", "test: inherited server"]);
    assert.throws(
      () => buildPublicSource({ root, commit: "HEAD", policies }),
      /still contains apps\/server/u,
    );
  }));

test("public source export rejects Git submodules", () =>
  withRepository((root) => {
    const head = runGit(root, ["rev-parse", "HEAD"]);
    runGit(root, [
      "update-index",
      "--add",
      "--cacheinfo",
      `160000,${head},vendor/external`,
    ]);
    runGit(root, ["commit", "-m", "test: gitlink"]);
    assert.throws(
      () => buildPublicSource({ root, commit: "HEAD", policies }),
      /rejects Git submodules/u,
    );
  }));

test("public source export rejects a symlink that escapes staging", () =>
  withRepository((root) => {
    const blob = runGit(root, ["hash-object", "-w", "--stdin"], {
      input: "../../outside",
    });
    runGit(root, [
      "update-index",
      "--add",
      "--cacheinfo",
      `120000,${blob},scripts/escape`,
    ]);
    runGit(root, ["commit", "-m", "test: escaping symlink"]);
    assert.throws(
      () => buildPublicSource({ root, commit: "HEAD", policies }),
      /symbolic link escapes public source/u,
    );
  }));

test("history scan finds a forbidden file even after it was deleted", () =>
  withRepository((root) => {
    write(root, "apps/server/secret.ts", "export const localOnly = true;\n");
    runGit(root, ["add", "apps/server/secret.ts"]);
    runGit(root, ["commit", "-m", "test: add forbidden history"]);
    rmSync(path.join(root, "apps", "server", "secret.ts"));
    runGit(root, ["add", "-A"]);
    runGit(root, ["commit", "-m", "test: delete forbidden history"]);
    const report = scanPublicHistory({ root, policies });
    assert.equal(report.summary, "FAIL");
    assert.ok(
      report.findings.some(
        (finding) =>
          finding.rule === "history-forbidden-prefix" &&
          finding.path === "apps/server/secret.ts",
      ),
    );
  }));

test("history scan rejects Git LFS pointers", () =>
  withRepository((root) => {
    write(
      root,
      "docs/demo.bin",
      "version https://git-lfs.github.com/spec/v1\noid sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nsize 12\n",
    );
    runGit(root, ["add", "docs/demo.bin"]);
    runGit(root, ["commit", "-m", "test: lfs pointer"]);
    const report = scanPublicHistory({ root, policies });
    assert.ok(
      report.findings.some((finding) => finding.rule === "history-lfs-pointer"),
    );
  }));

test("history scan passes a clean default-deny public history", () =>
  withRepository((root) => {
    const report = scanPublicHistory({ root, policies });
    assert.equal(report.summary, "PASS");
    assert.equal(report.totals.findings, 0);
    assert.equal(report.totals.skipped, 0);
  }));

test("missing build and artifact surfaces are explicitly SKIPPED", () =>
  withRepository((root) => {
    assert.equal(auditWebDist(root, policies).status, "SKIPPED");
    const checks = auditArtifactDirectory(
      path.join(root, "missing-artifacts"),
      root,
      policies,
    );
    assert.equal(checks[0].status, "SKIPPED");
  }));
