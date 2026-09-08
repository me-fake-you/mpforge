import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  deniedSourcePathReasons,
  isSourcePathAllowed,
  loadPublicPolicies,
  normalizeRelativePath,
  portablePublicReport,
  repositoryRoot,
  scanTextForPublicBoundary,
} from "./audit-public-boundary.mjs";
import { parseLsTree } from "./build-public-source.mjs";

const HISTORY_TEXT_LIMIT = 2 * 1024 * 1024;

function git(root, arguments_, options = {}) {
  return execFileSync("git", ["-C", root, ...arguments_], {
    encoding: Object.hasOwn(options, "encoding") ? options.encoding : "utf8",
    input: options.input,
    maxBuffer: options.maxBuffer ?? 512 * 1024 * 1024,
    windowsHide: true,
  });
}

function batchObjectSizes(root, objectIds) {
  if (objectIds.length === 0) return new Map();
  const output = git(root, ["cat-file", "--batch-check"], {
    input: `${objectIds.join("\n")}\n`,
  });
  const sizes = new Map();
  for (const line of output.trim().split(/\r?\n/u)) {
    const [object, type, size] = line.split(" ");
    if (type === "blob" && /^\d+$/u.test(size)) sizes.set(object, Number(size));
  }
  return sizes;
}

function batchObjectContents(root, objectIds) {
  const contents = new Map();
  for (let start = 0; start < objectIds.length; start += 64) {
    const chunk = objectIds.slice(start, start + 64);
    const output = git(root, ["cat-file", "--batch"], {
      encoding: null,
      input: Buffer.from(`${chunk.join("\n")}\n`, "utf8"),
    });
    let offset = 0;
    while (offset < output.length) {
      const lineEnd = output.indexOf(10, offset);
      if (lineEnd < 0) throw new Error("Invalid git cat-file batch response");
      const header = output.subarray(offset, lineEnd).toString("utf8");
      const [object, type, sizeText] = header.split(" ");
      if (type !== "blob" || !/^\d+$/u.test(sizeText)) {
        throw new Error(`Unexpected git cat-file response: ${header}`);
      }
      const size = Number(sizeText);
      const contentStart = lineEnd + 1;
      const contentEnd = contentStart + size;
      contents.set(object, output.subarray(contentStart, contentEnd));
      offset = contentEnd + 1;
    }
  }
  return contents;
}

function probablyBinary(buffer) {
  return buffer.subarray(0, Math.min(buffer.length, 8192)).includes(0);
}

function sizeException(relativePath, denylist) {
  return (denylist.source_size_exceptions ?? []).some((glob) => {
    const escaped = glob
      .replace(/[|\\{}()[\]^$+?.]/gu, "\\$&")
      .replaceAll("**", "\0")
      .replaceAll("*", "[^/]*")
      .replaceAll("\0", ".*");
    return new RegExp(`^${escaped}$`, "iu").test(relativePath);
  });
}

function collectHistoryTrees(root) {
  const commits = git(root, ["rev-list", "--all"])
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean);
  const blobPaths = new Map();
  const pathFindings = [];
  const submodules = [];
  const modes = new Map();
  for (const commit of commits) {
    const entries = parseLsTree(
      git(root, ["ls-tree", "-rz", "--full-tree", commit], { encoding: null }),
    );
    for (const entry of entries) {
      if (entry.mode === "160000" || entry.type === "commit") {
        submodules.push({ commit, path: entry.path });
        continue;
      }
      if (entry.type !== "blob") continue;
      if (!blobPaths.has(entry.object)) blobPaths.set(entry.object, new Set());
      blobPaths.get(entry.object).add(entry.path);
      if (!modes.has(entry.object)) modes.set(entry.object, new Set());
      modes.get(entry.object).add(entry.mode);
    }
  }
  return { commits, blobPaths, pathFindings, submodules, modes };
}

export function scanPublicHistory({
  root = repositoryRoot,
  policies = loadPublicPolicies(root),
} = {}) {
  const findings = [];
  const skipped = [];
  if (!existsSync(path.join(root, ".git"))) {
    return {
      schema_version: 1,
      generated_at: new Date().toISOString(),
      root,
      summary: "FAIL",
      findings: [
        {
          rule: "git-repository",
          detail: "public history root is not a Git worktree",
        },
      ],
      skipped,
    };
  }

  const references = git(root, ["for-each-ref", "--format=%(refname)"])
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean);
  for (const reference of references) {
    if (/^refs\/(?:original|backup|replace)\//iu.test(reference)) {
      findings.push({
        rule: "forbidden-ref",
        ref: reference,
        detail: "history backup ref is public",
      });
    }
    if (reference.startsWith("refs/tags/")) {
      const tag = reference.slice("refs/tags/".length);
      if (!(policies.allowlist.allowed_public_tags ?? []).includes(tag)) {
        findings.push({
          rule: "forbidden-tag",
          ref: reference,
          detail: "tag is not allowlisted",
        });
      }
    }
  }
  const referenceMetadata = git(root, [
    "for-each-ref",
    "--format=%(refname)%00%(authorname)%00%(authoremail)%00%(taggername)%00%(taggeremail)%00%(contents)%00",
  ]);
  for (const match of scanTextForPublicBoundary(
    referenceMetadata,
    "git-history/ref-metadata.txt",
    policies.denylist,
  )) {
    findings.push({
      rule: `history-ref-${match.rule}`,
      detail: `forbidden ref or annotated-tag metadata near line ${match.line}`,
    });
  }

  const history = collectHistoryTrees(root);
  for (const submodule of history.submodules) {
    findings.push({
      rule: "history-submodule",
      commit: submodule.commit,
      path: submodule.path,
      detail: "Git submodule is not allowed in public history",
    });
  }
  for (const [object, paths] of history.blobPaths) {
    for (const relativePath of paths) {
      let normalized;
      try {
        normalized = normalizeRelativePath(relativePath);
      } catch (error) {
        findings.push({
          rule: "unsafe-history-path",
          object,
          path: relativePath,
          detail: error.message,
        });
        continue;
      }
      if (!isSourcePathAllowed(normalized, policies.allowlist)) {
        findings.push({
          rule: "history-default-deny",
          object,
          path: normalized,
          detail: "path exists in reachable history but is not allowlisted",
        });
      }
      for (const detail of deniedSourcePathReasons(
        normalized,
        policies.denylist,
      )) {
        findings.push({
          rule: "history-deny-path",
          object,
          path: normalized,
          detail,
        });
      }
      for (const prefix of policies.denylist.history_forbidden_prefixes ?? []) {
        const lowerPath = normalized.toLowerCase();
        const lowerPrefix = prefix.toLowerCase();
        if (
          lowerPath === lowerPrefix ||
          lowerPath.startsWith(`${lowerPrefix}/`)
        ) {
          findings.push({
            rule: "history-forbidden-prefix",
            object,
            path: normalized,
            detail: prefix,
          });
        }
      }
    }
  }

  const objectIds = [...history.blobPaths.keys()];
  const sizes = batchObjectSizes(root, objectIds);
  const readable = [];
  for (const object of objectIds) {
    const bytes = sizes.get(object);
    const paths = [...history.blobPaths.get(object)];
    if (bytes > policies.denylist.source_max_file_bytes) {
      for (const relativePath of paths) {
        if (!sizeException(relativePath, policies.denylist)) {
          findings.push({
            rule: "history-large-blob",
            object,
            path: relativePath,
            detail: `${bytes} bytes exceeds ${policies.denylist.source_max_file_bytes}`,
          });
        }
      }
    }
    if (bytes <= HISTORY_TEXT_LIMIT) readable.push(object);
  }

  const contents = batchObjectContents(root, readable);
  for (const [object, buffer] of contents) {
    const paths = [...history.blobPaths.get(object)];
    const text = probablyBinary(buffer) ? null : buffer.toString("utf8");
    if (text === null) continue;
    if (text.startsWith("version https://git-lfs.github.com/spec/v1")) {
      for (const relativePath of paths) {
        findings.push({
          rule: "history-lfs-pointer",
          object,
          path: relativePath,
          detail: "Git LFS pointer is forbidden in the public source history",
        });
      }
    }
    if (/filter=lfs|filter\s*=\s*lfs/iu.test(text)) {
      for (const relativePath of paths.filter((candidate) =>
        candidate.endsWith(".gitattributes"),
      )) {
        findings.push({
          rule: "history-lfs-attributes",
          object,
          path: relativePath,
          detail: "Git LFS tracking configuration is forbidden",
        });
      }
    }
    for (const relativePath of paths) {
      for (const match of scanTextForPublicBoundary(
        text,
        relativePath,
        policies.denylist,
      )) {
        findings.push({
          rule: `history-${match.rule}`,
          object,
          path: relativePath,
          detail: `forbidden historical content at line ${match.line}`,
        });
      }
    }
  }

  try {
    const lfsFiles = git(root, ["lfs", "ls-files", "--all"])
      .trim()
      .split(/\r?\n/u)
      .filter(Boolean);
    for (const entry of lfsFiles) {
      findings.push({
        rule: "git-lfs-file",
        detail: entry.replace(/^\S+\s+/u, ""),
      });
    }
  } catch (error) {
    skipped.push({ check: "git-lfs-client", reason: error.message });
  }

  const metadata = git(root, [
    "log",
    "--all",
    "--format=%H%x00%an%x00%ae%x00%B%x00",
  ]);
  for (const match of scanTextForPublicBoundary(
    metadata,
    "git-history/commit-metadata.txt",
    policies.denylist,
  )) {
    findings.push({
      rule: `history-metadata-${match.rule}`,
      detail: `forbidden commit metadata near line ${match.line}`,
    });
  }

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    root,
    policy: "all-reachable-refs-default-deny",
    summary:
      findings.length > 0 ? "FAIL" : skipped.length > 0 ? "INCOMPLETE" : "PASS",
    totals: {
      refs: references.length,
      commits: history.commits.length,
      unique_blobs: objectIds.length,
      findings: findings.length,
      skipped: skipped.length,
    },
    findings,
    skipped,
  };
}

function parseArguments(argv) {
  const options = {
    root: repositoryRoot,
    output: null,
    requireComplete: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--root") options.root = path.resolve(argv[++index]);
    else if (argv[index] === "--output")
      options.output = path.resolve(argv[++index]);
    else if (argv[index] === "--require-complete")
      options.requireComplete = true;
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
    const options = parseArguments(process.argv.slice(2));
    const report = scanPublicHistory(options);
    const serialized = `${JSON.stringify(portablePublicReport(report, options.root), null, 2)}\n`;
    if (options.output) writeFileSync(options.output, serialized, "utf8");
    process.stdout.write(serialized);
    if (report.summary === "FAIL") process.exitCode = 1;
    else if (options.requireComplete && report.summary === "INCOMPLETE")
      process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  }
}
