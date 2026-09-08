import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  realpathSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  deniedSourcePathReasons,
  isSourcePathAllowed,
  loadPublicPolicies,
  normalizeRelativePath,
  repositoryRoot,
  validateSourceBuffer,
} from "./audit-public-boundary.mjs";

function git(root, arguments_, options = {}) {
  return execFileSync("git", ["-C", root, ...arguments_], {
    encoding: Object.hasOwn(options, "encoding") ? options.encoding : "utf8",
    input: options.input,
    maxBuffer: options.maxBuffer ?? 128 * 1024 * 1024,
    windowsHide: true,
  });
}

export function parseLsTree(buffer) {
  const entries = [];
  for (const record of buffer.toString("utf8").split("\0").filter(Boolean)) {
    const separator = record.indexOf("\t");
    if (separator < 0) throw new Error(`Invalid git ls-tree record: ${record}`);
    const metadata = record.slice(0, separator).split(" ");
    const relativePath = normalizeRelativePath(record.slice(separator + 1));
    const [mode, type, object] = metadata;
    if (!mode || !type || !object)
      throw new Error(`Invalid git ls-tree metadata: ${record}`);
    entries.push({ mode, type, object, path: relativePath });
  }
  return entries;
}

function resolveCommit(root, commit) {
  const resolved = git(root, [
    "rev-parse",
    "--verify",
    `${commit}^{commit}`,
  ]).trim();
  if (!/^[a-f0-9]{40,64}$/iu.test(resolved)) {
    throw new Error(`Unable to resolve commit ${JSON.stringify(commit)}`);
  }
  return resolved;
}

function assertCleanInput(root) {
  const status = git(root, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]);
  if (status.trim()) {
    throw new Error("Public source export refuses a dirty Git worktree");
  }
}

function safeSymlinkTarget(entry, entryPaths, policies) {
  const target = entry.buffer.toString("utf8").replaceAll("\\", "/");
  if (!target || target.startsWith("/") || /^[A-Za-z]:\//u.test(target)) {
    throw new Error(`${entry.path}: symbolic link target is absolute or empty`);
  }
  const resolved = path.posix.normalize(
    path.posix.join(path.posix.dirname(entry.path), target),
  );
  if (
    resolved === ".." ||
    resolved.startsWith("../") ||
    path.posix.isAbsolute(resolved)
  ) {
    throw new Error(
      `${entry.path}: symbolic link escapes public source (${target})`,
    );
  }
  const normalizedTarget = normalizeRelativePath(resolved);
  if (!entryPaths.has(normalizedTarget)) {
    throw new Error(
      `${entry.path}: symbolic link target is absent from selected source (${target})`,
    );
  }
  if (
    !isSourcePathAllowed(normalizedTarget, policies.allowlist) ||
    deniedSourcePathReasons(normalizedTarget, policies.denylist).length > 0
  ) {
    throw new Error(
      `${entry.path}: symbolic link targets a denied path (${target})`,
    );
  }
  return target;
}

function validateLockfile(selectedEntries) {
  const lock = selectedEntries.find((entry) => entry.path === "pnpm-lock.yaml");
  if (!lock) throw new Error("pnpm-lock.yaml is required in public source");
  const text = lock.buffer.toString("utf8");
  if (
    /^\s{2}apps\/server:\s*$/mu.test(text) ||
    /\b@wemd\/server\b/u.test(text)
  ) {
    throw new Error(
      "pnpm-lock.yaml still contains the apps/server workspace importer",
    );
  }
  for (const entry of selectedEntries.filter((candidate) =>
    candidate.path.endsWith("package.json"),
  )) {
    const manifest = JSON.parse(entry.buffer.toString("utf8"));
    const dependencyTables = [
      manifest.dependencies,
      manifest.devDependencies,
      manifest.optionalDependencies,
      manifest.peerDependencies,
    ];
    if (
      dependencyTables.some(
        (table) => table && Object.hasOwn(table, "@wemd/server"),
      )
    ) {
      throw new Error(`${entry.path} still depends on @wemd/server`);
    }
  }
}

function hashBuffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function publicStagingPath(root) {
  return path.resolve(root, "release", "staging", "public-source");
}

function assertStagingAncestorInsideRepository(root, staging) {
  const realRoot = realpathSync(root);
  let ancestor = staging;
  while (!existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  const realAncestor = realpathSync(ancestor);
  const relativeAncestor = path.relative(realRoot, realAncestor);
  if (relativeAncestor.startsWith("..") || path.isAbsolute(relativeAncestor)) {
    throw new Error("Public source staging ancestor escapes the repository");
  }
}

export function buildPublicSource({
  root = repositoryRoot,
  commit,
  policies = loadPublicPolicies(root),
} = {}) {
  if (!commit)
    throw new Error(
      "--commit is required; implicit working-tree export is forbidden",
    );
  const gitDirectory = path.join(root, ".git");
  if (!existsSync(gitDirectory))
    throw new Error(`${root} is not a Git worktree`);
  const resolvedCommit = resolveCommit(root, commit);
  const staging = publicStagingPath(root);
  const expected = path.resolve(root, "release", "staging", "public-source");
  if (
    staging !== expected ||
    !staging.startsWith(`${path.resolve(root)}${path.sep}`)
  ) {
    throw new Error("Public source staging path escaped the repository");
  }
  assertStagingAncestorInsideRepository(root, staging);
  if (existsSync(staging) && readdirSync(staging).length > 0) {
    throw new Error(`Public source staging is not empty: ${staging}`);
  }

  const tree = parseLsTree(
    git(root, ["ls-tree", "-rz", "--full-tree", resolvedCommit], {
      encoding: null,
    }),
  );
  const submodules = tree.filter(
    (entry) => entry.mode === "160000" || entry.type === "commit",
  );
  if (submodules.length > 0) {
    throw new Error(
      `Public source export rejects Git submodules: ${submodules.map((entry) => entry.path).join(", ")}`,
    );
  }
  const serverEntries = tree.filter((entry) =>
    entry.path.toLowerCase().startsWith("apps/server/"),
  );
  if (serverEntries.length > 0) {
    throw new Error(
      "Source commit still contains apps/server; resolve the license blocker first",
    );
  }

  const selected = tree.filter(
    (entry) =>
      (entry.type === "blob" || entry.mode === "120000") &&
      isSourcePathAllowed(entry.path, policies.allowlist),
  );
  for (const entry of selected) {
    entry.buffer = git(root, ["cat-file", "blob", entry.object], {
      encoding: null,
    });
    const findings = validateSourceBuffer(entry.path, entry.buffer, policies);
    if (findings.length > 0) {
      throw new Error(
        `${entry.path}: public boundary violation: ${findings
          .map((finding) => `${finding.rule} (${finding.detail})`)
          .join("; ")}`,
      );
    }
  }
  const selectedPaths = new Set(selected.map((entry) => entry.path));
  for (const entry of selected.filter(
    (candidate) => candidate.mode === "120000",
  )) {
    safeSymlinkTarget(entry, selectedPaths, policies);
  }
  for (const requiredPath of policies.allowlist.required_paths ?? []) {
    if (!selectedPaths.has(requiredPath)) {
      throw new Error(
        `Required public source path is missing at ${resolvedCommit}: ${requiredPath}`,
      );
    }
  }
  validateLockfile(selected);
  assertCleanInput(root);

  mkdirSync(staging, { recursive: true });
  for (const entry of selected) {
    const destination = path.join(staging, ...entry.path.split("/"));
    mkdirSync(path.dirname(destination), { recursive: true });
    if (entry.mode === "120000") {
      const target = safeSymlinkTarget(entry, selectedPaths, policies);
      symlinkSync(target, destination);
    } else {
      writeFileSync(destination, entry.buffer);
    }
  }

  const manifestPath = path.join(
    staging,
    "release",
    "public-release-manifest.json",
  );
  const manifestFiles = selected
    .filter((entry) => entry.path !== "release/public-release-manifest.json")
    .map((entry) => ({
      path: entry.path,
      sha256: hashBuffer(entry.buffer),
      size: entry.buffer.length,
      mode: entry.mode,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const manifest = {
    schema_version: 1,
    generated: true,
    release: "v0.1.0",
    source_commit: resolvedCommit,
    history_strategy: "clean-source",
    public_repository: null,
    generated_at: new Date().toISOString(),
    files: manifestFiles,
    gates: {
      public_boundary: "PENDING",
      public_history: "PENDING",
      license: "PENDING",
      secret_scan: "PENDING",
      artifact_scan: "PENDING",
    },
    claims: {
      mock_e2e_verified: true,
      real_adapter_contract_verified: true,
      live_account_tested: false,
      formal_publish_supported: false,
      mass_send_supported: false,
    },
  };
  mkdirSync(path.dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return {
    root,
    staging,
    source_commit: resolvedCommit,
    copied_files: selected.length,
    excluded_files: tree.length - selected.length,
    manifest: path.relative(root, manifestPath).replaceAll("\\", "/"),
  };
}

function parseArguments(argv) {
  const options = { root: repositoryRoot, commit: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--root") options.root = path.resolve(argv[++index]);
    else if (argv[index] === "--commit") options.commit = argv[++index];
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  return options;
}

function isMain(metaUrl) {
  return (
    Boolean(process.argv[1]) && metaUrl === pathToFileURL(process.argv[1]).href
  );
}

if (isMain(import.meta.url)) {
  try {
    process.stdout.write(
      `${JSON.stringify(buildPublicSource(parseArguments(process.argv.slice(2))), null, 2)}\n`,
    );
  } catch (error) {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  }
}
