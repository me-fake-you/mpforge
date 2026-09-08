import { execFileSync, spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = path.resolve(scriptDirectory, "..");
const TEXT_SCAN_LIMIT = 2 * 1024 * 1024;

export function normalizeRelativePath(value) {
  const normalized = String(value).replaceAll("\\", "/").replace(/^\.\//u, "");
  if (
    normalized.length === 0 ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//u.test(normalized) ||
    normalized.split("/").includes("..") ||
    normalized.includes("\0")
  ) {
    throw new Error(`Unsafe relative path: ${JSON.stringify(value)}`);
  }
  return normalized.replace(/\/{2,}/gu, "/").replace(/\/$/u, "");
}

export function portablePublicReport(report, root) {
  const absoluteRoot = path.resolve(root);
  const normalizeString = (value) => {
    const absoluteCandidate = path.isAbsolute(value)
      ? path.resolve(value)
      : null;
    if (value === absoluteRoot || absoluteCandidate === absoluteRoot)
      return ".";
    if (
      value.startsWith(`${absoluteRoot}${path.sep}`) ||
      absoluteCandidate?.startsWith(`${absoluteRoot}${path.sep}`)
    ) {
      return path
        .relative(absoluteRoot, absoluteCandidate ?? value)
        .replaceAll("\\", "/");
    }
    return value
      .replaceAll(absoluteRoot, ".")
      .replaceAll(absoluteRoot.replaceAll("\\", "/"), ".");
  };
  const visit = (value) => {
    if (typeof value === "string") return normalizeString(value);
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, nested]) => [key, visit(nested)]),
      );
    }
    return value;
  };
  return visit(report);
}

export function globToRegExp(glob, { caseInsensitive = false } = {}) {
  const value = normalizeRelativePath(glob);
  let expression = "^";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "*") {
      if (value[index + 1] === "*") {
        index += 1;
        if (value[index + 1] === "/") {
          index += 1;
          expression += "(?:.*/)?";
        } else {
          expression += ".*";
        }
      } else {
        expression += "[^/]*";
      }
    } else if (character === "?") {
      expression += "[^/]";
    } else {
      expression += character.replace(/[|\\{}()[\]^$+?.]/gu, "\\$&");
    }
  }
  return new RegExp(`${expression}$`, caseInsensitive ? "iu" : "u");
}

export function matchesGlob(relativePath, glob, options) {
  return globToRegExp(glob, options).test(normalizeRelativePath(relativePath));
}

export function loadPublicPolicies(root = repositoryRoot) {
  const readJson = (relativePath) =>
    JSON.parse(readFileSync(path.join(root, relativePath), "utf8"));
  const allowlist = readJson("release/public-allowlist.json");
  const denylist = readJson("release/public-denylist.json");
  if (allowlist.policy !== "default-deny") {
    throw new Error("Public allowlist must declare default-deny policy");
  }
  if (denylist.policy !== "error-on-match") {
    throw new Error("Public denylist must declare error-on-match policy");
  }
  return { allowlist, denylist };
}

function hasPrefix(relativePath, prefix) {
  const normalizedPrefix = normalizeRelativePath(prefix);
  return (
    relativePath.toLowerCase() === normalizedPrefix.toLowerCase() ||
    relativePath.toLowerCase().startsWith(`${normalizedPrefix.toLowerCase()}/`)
  );
}

export function isSourcePathAllowed(relativePath, allowlist) {
  const normalized = normalizeRelativePath(relativePath);
  if (
    (allowlist.include_files ?? []).some(
      (candidate) => candidate.toLowerCase() === normalized.toLowerCase(),
    )
  ) {
    return true;
  }
  if (
    (allowlist.include_directories ?? []).some((candidate) =>
      hasPrefix(normalized, candidate),
    )
  ) {
    return true;
  }
  return (allowlist.conditional_globs ?? []).some((candidate) =>
    matchesGlob(normalized, candidate, { caseInsensitive: true }),
  );
}

function isException(relativePath, values, kind = "prefix") {
  return (values ?? []).some((candidate) =>
    kind === "glob"
      ? matchesGlob(relativePath, candidate, { caseInsensitive: true })
      : hasPrefix(relativePath, candidate),
  );
}

export function deniedSourcePathReasons(relativePath, denylist) {
  const normalized = normalizeRelativePath(relativePath);
  const reasons = [];
  const prefixException = isException(
    normalized,
    denylist.path_prefix_exceptions,
  );
  if (!prefixException) {
    for (const candidate of denylist.path_prefixes ?? []) {
      if (hasPrefix(normalized, candidate))
        reasons.push(`forbidden prefix ${candidate}`);
    }
  }
  if (
    (denylist.exact_paths ?? []).some(
      (candidate) => candidate.toLowerCase() === normalized.toLowerCase(),
    )
  ) {
    reasons.push("forbidden exact path");
  }
  const segments = normalized.toLowerCase().split("/");
  for (const candidate of denylist.path_segments ?? []) {
    if (segments.includes(candidate.toLowerCase())) {
      reasons.push(`forbidden segment ${candidate}`);
    }
  }
  const globException = isException(
    normalized,
    denylist.path_glob_exceptions,
    "glob",
  );
  if (!globException) {
    for (const candidate of denylist.path_globs ?? []) {
      if (matchesGlob(normalized, candidate, { caseInsensitive: true })) {
        reasons.push(`forbidden pattern ${candidate}`);
      }
    }
  }
  return [...new Set(reasons)];
}

function contentRuleExcluded(relativePath, denylist) {
  return (
    (denylist.content_rule_excluded_files ?? []).some(
      (candidate) => candidate.toLowerCase() === relativePath.toLowerCase(),
    ) ||
    (denylist.content_rule_excluded_prefixes ?? []).some((prefix) =>
      hasPrefix(relativePath, prefix),
    ) ||
    (denylist.content_rule_excluded_globs ?? []).some((glob) =>
      matchesGlob(relativePath, glob, { caseInsensitive: true }),
    )
  );
}

export function scanTextForPublicBoundary(text, relativePath, denylist) {
  if (contentRuleExcluded(relativePath, denylist)) return [];
  const findings = [];
  for (const rule of denylist.content_rules ?? []) {
    if (
      (rule.excluded_files ?? []).some(
        (candidate) => candidate.toLowerCase() === relativePath.toLowerCase(),
      ) ||
      (rule.excluded_prefixes ?? []).some((prefix) =>
        hasPrefix(relativePath, prefix),
      )
    ) {
      continue;
    }
    if (
      Array.isArray(rule.extensions) &&
      !rule.extensions.some((extension) =>
        relativePath.toLowerCase().endsWith(extension.toLowerCase()),
      )
    ) {
      continue;
    }
    const flags = [...new Set(`${rule.flags ?? ""}gu`.split(""))].join("");
    const expression = new RegExp(rule.expression, flags);
    for (const match of text.matchAll(expression)) {
      if (
        (rule.allowed_values ?? []).some(
          (candidate) => candidate.toLowerCase() === match[0].toLowerCase(),
        )
      ) {
        continue;
      }
      const offset = match.index ?? 0;
      const line = text.slice(0, offset).split(/\r?\n/u).length;
      findings.push({ rule: rule.id, line });
    }
  }
  return findings;
}

function isProbablyBinary(buffer) {
  return buffer.subarray(0, Math.min(buffer.length, 8192)).includes(0);
}

function sizeAllowed(relativePath, bytes, denylist) {
  if (bytes <= denylist.source_max_file_bytes) return true;
  return (denylist.source_size_exceptions ?? []).some((candidate) =>
    matchesGlob(relativePath, candidate, { caseInsensitive: true }),
  );
}

export function validateSourceBuffer(
  relativePath,
  buffer,
  { allowlist, denylist },
) {
  const normalized = normalizeRelativePath(relativePath);
  const findings = [];
  if (!isSourcePathAllowed(normalized, allowlist)) {
    findings.push({
      path: normalized,
      rule: "default-deny",
      detail: "not allowlisted",
    });
  }
  for (const detail of deniedSourcePathReasons(normalized, denylist)) {
    findings.push({ path: normalized, rule: "deny-path", detail });
  }
  if (!sizeAllowed(normalized, buffer.length, denylist)) {
    findings.push({
      path: normalized,
      rule: "source-size",
      detail: `${buffer.length} bytes exceeds ${denylist.source_max_file_bytes}`,
    });
  }
  if (!isProbablyBinary(buffer) && buffer.length <= TEXT_SCAN_LIMIT) {
    const text = buffer.toString("utf8");
    for (const match of scanTextForPublicBoundary(text, normalized, denylist)) {
      findings.push({
        path: normalized,
        rule: match.rule,
        detail: `possible private or forbidden content at line ${match.line}`,
      });
    }
  }
  return findings;
}

function walkFiles(root, current = root) {
  const files = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const absolutePath = path.join(current, entry.name);
    const information = lstatSync(absolutePath);
    if (information.isSymbolicLink()) {
      files.push({ absolutePath, information, symbolicLink: true });
    } else if (entry.isDirectory()) {
      files.push(...walkFiles(root, absolutePath));
    } else if (entry.isFile()) {
      files.push({ absolutePath, information, symbolicLink: false });
    }
  }
  return files;
}

function git(root, arguments_, options = {}) {
  return execFileSync("git", ["-C", root, ...arguments_], {
    encoding: Object.hasOwn(options, "encoding") ? options.encoding : "utf8",
    input: options.input,
    maxBuffer: options.maxBuffer ?? 128 * 1024 * 1024,
    windowsHide: true,
  });
}

export function trackedPaths(root) {
  return git(root, ["ls-files", "-z"])
    .split("\0")
    .filter(Boolean)
    .map(normalizeRelativePath);
}

function result(id, target, status, findings = [], details = {}) {
  return { id, target, status, findings, ...details };
}

export function auditTrackedFiles(root, policies) {
  const findings = [];
  let files;
  try {
    files = trackedPaths(root);
  } catch (error) {
    return result("tracked-source", root, "SKIPPED", [], {
      reason: `Git index unavailable: ${error.message}`,
    });
  }
  for (const relativePath of files) {
    const absolutePath = path.join(root, relativePath);
    if (!existsSync(absolutePath)) {
      findings.push({
        path: relativePath,
        rule: "tracked-file-missing",
        detail: "tracked file is missing from the worktree",
      });
      continue;
    }
    const information = lstatSync(absolutePath);
    if (information.isSymbolicLink()) {
      const target = readlinkSync(absolutePath);
      findings.push(
        ...validateSourceBuffer(
          relativePath,
          Buffer.from(target, "utf8"),
          policies,
        ),
      );
      const resolved = realpathSync(absolutePath);
      const relativeTarget = path.relative(root, resolved);
      if (relativeTarget.startsWith("..") || path.isAbsolute(relativeTarget)) {
        findings.push({
          path: relativePath,
          rule: "escaping-symlink",
          detail: "symbolic link resolves outside repository",
        });
      }
      continue;
    }
    findings.push(
      ...validateSourceBuffer(
        relativePath,
        readFileSync(absolutePath),
        policies,
      ),
    );
  }
  for (const requiredPath of policies.allowlist.required_paths ?? []) {
    if (!files.some((candidate) => candidate === requiredPath)) {
      findings.push({
        path: requiredPath,
        rule: "required-path",
        detail: "required public file is not tracked",
      });
    }
  }
  return result(
    "tracked-source",
    root,
    findings.length === 0 ? "PASS" : "FAIL",
    findings,
    { scanned_files: files.length },
  );
}

export function auditExportInventory(root) {
  const manifestPath = "release/public-release-manifest.json";
  if (!existsSync(path.join(root, manifestPath))) {
    return result("export-inventory", root, "PASS", [], {
      reason: "not a generated public export",
    });
  }
  const findings = [];
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path.join(root, manifestPath), "utf8"));
    if (manifest.generated === false) {
      return result("export-inventory", root, "PASS", [], {
        reason: "development manifest; no exported inventory applies",
      });
    }
    if (manifest.generated !== true || !Array.isArray(manifest.files)) {
      throw new Error("generated export must declare a files array");
    }
  } catch (error) {
    return result("export-inventory", root, "FAIL", [
      {
        path: manifestPath,
        rule: "invalid-export-manifest",
        detail: error.message,
      },
    ]);
  }
  const tracked = new Set(trackedPaths(root));
  const seen = new Set();
  for (const entry of manifest.files) {
    let relativePath;
    try {
      if (!entry || typeof entry.path !== "string") {
        throw new Error("inventory entry must have a path");
      }
      relativePath = normalizeRelativePath(entry.path);
      if (relativePath === manifestPath || seen.has(relativePath)) {
        throw new Error("inventory contains itself or a duplicate path");
      }
      seen.add(relativePath);
      if (
        !/^[a-f0-9]{64}$/iu.test(entry.sha256 ?? "") ||
        !Number.isSafeInteger(entry.size) ||
        entry.size < 0
      ) {
        throw new Error("inventory entry needs a SHA-256 digest and byte size");
      }
    } catch (error) {
      findings.push({
        path: manifestPath,
        rule: "invalid-export-entry",
        detail: error.message,
      });
      continue;
    }
    if (!tracked.has(relativePath)) {
      findings.push({
        path: relativePath,
        rule: "export-file-untracked",
        detail: "exported source is absent from the Git index",
      });
    } else if (!existsSync(path.join(root, relativePath))) {
      findings.push({
        path: relativePath,
        rule: "export-file-missing",
        detail: "exported source is absent from the worktree",
      });
    }
  }
  // These hashes describe the source_commit export baseline, not future edits.
  // Release metadata records current content hashes. Extra generated metadata is valid.
  return result(
    "export-inventory",
    root,
    findings.length ? "FAIL" : "PASS",
    findings,
    {
      declared_files: manifest.files.length,
      method:
        "export-baseline inventory presence in the Git index and worktree; current hashes belong to release metadata",
    },
  );
}

function readmeLocalTargets(markdown) {
  const text = markdown
    .replace(/<!--[^]*?-->/gu, "")
    .replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[^]*?^ {0,3}\1[^\n]*$/gmu, "")
    .replace(/(`+)[^]*?\1/gu, "");
  const targets = new Set();
  // Inline Markdown links/images, reference definitions, and quoted HTML links/images.
  for (const expression of [
    /!?\[[^\]\n]*\]\(\s*(?:<([^>]+)>|([^\s]+?))\s*(?:["'][^\n]*?["']\s*)?\)/gu,
    /^ {0,3}\[[^\]\n]+\]:\s*(?:<([^>]+)>|(\S+))/gmu,
    /<(?:a|img)\b[^>]*?\b(?:href|src)\s*=\s*["']([^"']+)["'][^>]*>/giu,
  ]) {
    for (const match of text.matchAll(expression)) {
      const target = match[1] ?? match[2];
      if (target && !/^(?:[a-z][a-z\d+.-]*:|\/\/|#|\?)/iu.test(target))
        targets.add(target);
    }
  }
  return [...targets];
}

export function auditReadmeLinks(root) {
  const tracked = new Set(trackedPaths(root));
  const readmes = [...tracked].filter((entry) =>
    /^README(?:\.[\w-]+)?\.md$/iu.test(entry),
  );
  const findings = [];
  let checked = 0;
  for (const readme of readmes) {
    if (!existsSync(path.join(root, readme))) continue;
    for (const target of readmeLocalTargets(
      readFileSync(path.join(root, readme), "utf8"),
    )) {
      checked += 1;
      let relativePath;
      try {
        const decoded = decodeURIComponent(target.split(/[?#]/u)[0]).replaceAll(
          "\\",
          "/",
        );
        relativePath = normalizeRelativePath(
          path.posix.normalize(
            path.posix.join(path.posix.dirname(readme), decoded),
          ),
        );
        if (decoded.startsWith("/")) throw new Error("absolute local target");
      } catch {
        findings.push({
          path: readme,
          rule: "readme-unsafe-local-link",
          detail: `unsafe local target ${JSON.stringify(target)}`,
        });
        continue;
      }
      const absolutePath = path.join(root, relativePath);
      const present = existsSync(absolutePath);
      const included =
        tracked.has(relativePath) ||
        (present &&
          statSync(absolutePath).isDirectory() &&
          [...tracked].some((entry) => entry.startsWith(`${relativePath}/`)));
      if (!present || !included) {
        findings.push({
          path: readme,
          rule: "readme-local-link-missing",
          detail: `local target ${JSON.stringify(relativePath)} is ${present ? "not tracked" : "missing"}`,
        });
      }
    }
  }
  return result(
    "readme-local-links",
    root,
    findings.length ? "FAIL" : "PASS",
    findings,
    {
      scanned_readmes: readmes.length,
      checked_local_targets: checked,
    },
  );
}

export function auditSourceDirectory(
  directory,
  policies,
  id = "public-staging",
) {
  if (!existsSync(directory)) {
    return result(id, directory, "SKIPPED", [], {
      reason: "directory does not exist",
    });
  }
  const findings = [];
  const entries = walkFiles(directory);
  for (const entry of entries) {
    const relativePath = normalizeRelativePath(
      path.relative(directory, entry.absolutePath),
    );
    if (entry.symbolicLink) {
      const target = readlinkSync(entry.absolutePath);
      findings.push(
        ...validateSourceBuffer(
          relativePath,
          Buffer.from(target, "utf8"),
          policies,
        ),
      );
      const resolved = realpathSync(entry.absolutePath);
      const relativeTarget = path.relative(directory, resolved);
      if (relativeTarget.startsWith("..") || path.isAbsolute(relativeTarget)) {
        findings.push({
          path: relativePath,
          rule: "escaping-symlink",
          detail: "symbolic link resolves outside public source",
        });
      }
      continue;
    }
    findings.push(
      ...validateSourceBuffer(
        relativePath,
        readFileSync(entry.absolutePath),
        policies,
      ),
    );
  }
  for (const requiredPath of policies.allowlist.required_paths ?? []) {
    if (!existsSync(path.join(directory, requiredPath))) {
      findings.push({
        path: requiredPath,
        rule: "required-path",
        detail: "required public file is absent",
      });
    }
  }
  return result(
    id,
    directory,
    findings.length === 0 ? "PASS" : "FAIL",
    findings,
    {
      scanned_files: entries.length,
    },
  );
}

function dockerGlobToRegExp(pattern) {
  const normalized = pattern.replaceAll("\\", "/").replace(/^\//u, "");
  const directoryPattern = normalized.endsWith("/");
  const body = directoryPattern ? normalized.slice(0, -1) : normalized;
  const containsSlash = body.includes("/");
  const glob = globToRegExp(body || "**", {
    caseInsensitive: os.platform() === "win32",
  });
  if (containsSlash) {
    const source = glob.source.replace(/\$$/u, "");
    return new RegExp(`${source}(?:/.*)?$`, glob.flags);
  }
  const escaped = glob.source.replace(/^\^/u, "").replace(/\$$/u, "");
  return new RegExp(`(?:^|/)${escaped}(?:/.*)?$`, glob.flags);
}

export function dockerContextIncludes(relativePath, dockerignoreText) {
  const normalized = normalizeRelativePath(relativePath);
  let ignored = false;
  for (const rawLine of dockerignoreText.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const negated = line.startsWith("!");
    const pattern = negated ? line.slice(1) : line;
    if (!pattern) continue;
    if (dockerGlobToRegExp(pattern).test(normalized)) ignored = !negated;
  }
  return !ignored;
}

export function auditDockerContext(root, policies) {
  const ignorePath = path.join(root, ".dockerignore");
  if (!existsSync(ignorePath)) {
    return result("docker-context", root, "SKIPPED", [], {
      reason: ".dockerignore is absent; exact Docker context was not computed",
    });
  }
  const ignoreText = readFileSync(ignorePath, "utf8");
  const findings = [];
  const probes = new Set([
    ...policies.denylist.path_prefixes,
    ...policies.denylist.exact_paths,
  ]);
  for (const candidate of probes) {
    const absolutePath = path.join(root, candidate);
    if (!existsSync(absolutePath)) continue;
    const probe = statSync(absolutePath).isDirectory()
      ? `${normalizeRelativePath(candidate)}/__public_boundary_probe__`
      : normalizeRelativePath(candidate);
    if (dockerContextIncludes(probe, ignoreText)) {
      findings.push({
        path: candidate,
        rule: "docker-context-leak",
        detail: "forbidden local path is not excluded by .dockerignore",
      });
    }
  }
  return result(
    "docker-context",
    root,
    findings.length === 0 ? "PASS" : "FAIL",
    findings,
    {
      method: "ordered .dockerignore policy probes",
      limitation: "Docker daemon was not invoked",
    },
  );
}

function sourceMapFindings(relativePath, buffer, policies) {
  const findings = [
    {
      path: relativePath,
      rule: "source-map-in-public-artifact",
      detail: "source maps are excluded from public release artifacts",
    },
  ];
  try {
    const sourceMap = JSON.parse(buffer.toString("utf8"));
    for (const source of sourceMap.sources ?? []) {
      if (
        /^[A-Za-z]:[\\/]/u.test(source) ||
        source.startsWith("/home/") ||
        source.startsWith("/Users/") ||
        source.includes("apps/server") ||
        source.includes("operations/")
      ) {
        findings.push({
          path: relativePath,
          rule: "source-map-private-source",
          detail: `unsafe source entry ${JSON.stringify(source)}`,
        });
      }
    }
    for (const sourceContent of sourceMap.sourcesContent ?? []) {
      if (typeof sourceContent !== "string") continue;
      for (const match of scanTextForPublicBoundary(
        sourceContent,
        relativePath,
        policies.denylist,
      )) {
        findings.push({
          path: relativePath,
          rule: `source-map-${match.rule}`,
          detail: "forbidden content is embedded in sourcesContent",
        });
      }
    }
  } catch (error) {
    findings.push({
      path: relativePath,
      rule: "invalid-source-map",
      detail: error.message,
    });
  }
  return findings;
}

export function auditWebDist(root, policies) {
  const directory = path.join(root, "apps", "web", "dist");
  if (!existsSync(directory)) {
    return result("web-dist", directory, "SKIPPED", [], {
      reason: "Web build output does not exist",
    });
  }
  const findings = [];
  const entries = walkFiles(directory).filter((entry) => !entry.symbolicLink);
  for (const entry of entries) {
    const relativePath = normalizeRelativePath(
      path.relative(directory, entry.absolutePath),
    );
    const buffer = readFileSync(entry.absolutePath);
    if (relativePath.toLowerCase().endsWith(".map")) {
      findings.push(...sourceMapFindings(relativePath, buffer, policies));
    } else if (!isProbablyBinary(buffer) && buffer.length <= TEXT_SCAN_LIMIT) {
      for (const match of scanTextForPublicBoundary(
        buffer.toString("utf8"),
        `apps/web/dist/${relativePath}`,
        policies.denylist,
      )) {
        // Minified third-party bundles frequently contain strings that resemble
        // email addresses. The tracked/staging source scan remains authoritative
        // for email literals; generated bundles still enforce all secret/path rules.
        if (match.rule === "private-email") continue;
        findings.push({
          path: relativePath,
          rule: match.rule,
          detail: `forbidden bundled content at line ${match.line}`,
        });
      }
    }
  }
  return result(
    "web-dist",
    directory,
    findings.length === 0 ? "PASS" : "FAIL",
    findings,
    {
      scanned_files: entries.length,
      email_literal_coverage: "tracked and public-staging source scans",
    },
  );
}

function locatePnpmPackage(root, prefix, packageRelativePath) {
  const pnpmDirectory = path.join(root, "node_modules", ".pnpm");
  if (!existsSync(pnpmDirectory)) return null;
  const versionDirectory = readdirSync(pnpmDirectory, {
    withFileTypes: true,
  }).find((entry) => entry.isDirectory() && entry.name.startsWith(prefix));
  if (!versionDirectory) return null;
  const candidate = path.join(
    pnpmDirectory,
    versionDirectory.name,
    packageRelativePath,
  );
  return existsSync(candidate) ? candidate : null;
}

function loadAsar(root) {
  const require = createRequire(import.meta.url);
  const candidates = [
    path.join(root, "node_modules", "@electron", "asar"),
    locatePnpmPackage(
      root,
      "@electron+asar@",
      path.join("node_modules", "@electron", "asar"),
    ),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      // Try the next project-local package location.
    }
  }
  return null;
}

function artifactEntryFindings(entry, denylist, { asar = false } = {}) {
  const archivePath = String(entry).replaceAll("\\", "/");
  if (
    (!asar && archivePath.startsWith("/")) ||
    /^[A-Za-z]:\//u.test(archivePath) ||
    archivePath.split("/").includes("..") ||
    archivePath.includes("\0")
  ) {
    return [
      {
        path: entry,
        rule: "unsafe-archive-path",
        detail: "archive entry is absolute, traverses parents, or contains NUL",
      },
    ];
  }
  let normalized;
  try {
    normalized = normalizeRelativePath(
      asar ? archivePath.replace(/^\/+/u, "") : archivePath,
    );
  } catch (error) {
    return [
      { path: entry, rule: "unsafe-archive-path", detail: error.message },
    ];
  }
  const findings = [];
  const segments = normalized.toLowerCase().split("/");
  for (const candidate of denylist.artifact_forbidden_segments ?? []) {
    if (segments.includes(candidate.toLowerCase())) {
      findings.push({
        path: normalized,
        rule: "artifact-forbidden-segment",
        detail: candidate,
      });
    }
  }
  for (const candidate of denylist.artifact_forbidden_globs ?? []) {
    if (matchesGlob(normalized, candidate, { caseInsensitive: true })) {
      findings.push({
        path: normalized,
        rule: "artifact-forbidden-pattern",
        detail: candidate,
      });
    }
  }
  if (/(?:\.test|\.spec)\.[cm]?[jt]sx?$/iu.test(normalized)) {
    findings.push({
      path: normalized,
      rule: "artifact-test-file",
      detail: "test file shipped",
    });
  }
  return findings;
}

export function auditAsarFile(asarPath, root, policies) {
  const asar = loadAsar(root);
  if (!asar) {
    return result("asar", asarPath, "SKIPPED", [], {
      reason: "project-local @electron/asar reader is unavailable",
    });
  }
  const findings = [];
  let entries;
  try {
    entries = asar.listPackage(asarPath);
  } catch (error) {
    return result("asar", asarPath, "FAIL", [
      { path: asarPath, rule: "invalid-asar", detail: error.message },
    ]);
  }
  for (const entry of entries) {
    findings.push(
      ...artifactEntryFindings(entry, policies.denylist, { asar: true }),
    );
    if (/\.(?:js|cjs|html)$/iu.test(entry)) {
      try {
        const relativeEntry = entry.replace(/^[/\\]+/u, "");
        const information = asar.statFile(asarPath, relativeEntry, false);
        if (information.files || information.link) continue;
        const buffer = asar.extractFile(asarPath, relativeEntry);
        for (const finding of scanTextForPublicBoundary(
          buffer.toString("utf8"),
          entry.replace(/^[/\\]+/u, "").replaceAll("\\", "/"),
          policies.denylist,
        )) {
          if (finding.rule !== "excluded-vendored-gpl-digest") continue;
          findings.push({
            path: entry,
            rule: finding.rule,
            detail: "excluded vendored GPL implementation in packaged content",
          });
        }
      } catch (error) {
        findings.push({
          path: entry,
          rule: "asar-read-error",
          detail: error.message,
        });
      }
    }
    if (!entry.toLowerCase().endsWith(".map")) continue;
    try {
      findings.push(
        ...sourceMapFindings(
          entry,
          asar.extractFile(asarPath, entry.replace(/^[/\\]/u, "")),
          policies,
        ),
      );
    } catch (error) {
      findings.push({
        path: entry,
        rule: "asar-read-error",
        detail: error.message,
      });
    }
  }
  return result(
    "asar",
    asarPath,
    findings.length === 0 ? "PASS" : "FAIL",
    findings,
    {
      scanned_entries: entries.length,
    },
  );
}

function locateSevenZip(root) {
  const executable = os.platform() === "win32" ? "7za.exe" : "7za";
  const platformDirectory =
    os.platform() === "win32"
      ? "win"
      : os.platform() === "darwin"
        ? "mac"
        : "linux";
  const architecture =
    os.arch() === "arm64" ? "arm64" : os.arch() === "ia32" ? "ia32" : "x64";
  return locatePnpmPackage(
    root,
    "7zip-bin@",
    path.join(
      "node_modules",
      "7zip-bin",
      platformDirectory,
      architecture,
      executable,
    ),
  );
}

function listWithSevenZip(sevenZip, archivePath) {
  const output = execFileSync(sevenZip, ["l", "-slt", archivePath], {
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    windowsHide: true,
  });
  const delimiter = output.indexOf("----------");
  const body = delimiter >= 0 ? output.slice(delimiter) : output;
  return body
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("Path = "))
    .map((line) => line.slice("Path = ".length));
}

function extractArchiveMember(sevenZip, archivePath, member, root) {
  const temporaryRoot = path.join(root, "tmp");
  mkdirSync(temporaryRoot, { recursive: true });
  const temporaryDirectory = mkdtempSync(
    path.join(temporaryRoot, "public-boundary-audit-"),
  );
  const outputPath = path.join(temporaryDirectory, "nested-app.asar");
  const descriptor = openSync(outputPath, "w");
  try {
    const execution = spawnSync(sevenZip, ["e", "-so", archivePath, member], {
      stdio: ["ignore", descriptor, "pipe"],
      windowsHide: true,
    });
    if (execution.status !== 0) {
      throw new Error(
        execution.stderr?.toString("utf8") || "7-Zip extraction failed",
      );
    }
  } finally {
    closeSync(descriptor);
  }
  return { outputPath, temporaryDirectory };
}

function auditArchive(archivePath, root, policies) {
  const sevenZip = locateSevenZip(root);
  if (!sevenZip) {
    return result("archive", archivePath, "SKIPPED", [], {
      reason: "project-local 7zip-bin reader is unavailable",
    });
  }
  let entries;
  try {
    entries = listWithSevenZip(sevenZip, archivePath);
  } catch (error) {
    return result("archive", archivePath, "FAIL", [
      { path: archivePath, rule: "archive-read-error", detail: error.message },
    ]);
  }
  const findings = entries.flatMap((entry) =>
    artifactEntryFindings(entry, policies.denylist),
  );
  const nestedAsar = entries.find((entry) =>
    /(?:^|[\\/])resources[\\/]app\.asar$/iu.test(entry),
  );
  let nested = null;
  if (nestedAsar) {
    let extracted;
    try {
      extracted = extractArchiveMember(sevenZip, archivePath, nestedAsar, root);
      nested = auditAsarFile(extracted.outputPath, root, policies);
      findings.push(...nested.findings);
    } catch (error) {
      nested = result("nested-asar", archivePath, "SKIPPED", [], {
        reason: error.message,
      });
    } finally {
      if (extracted?.temporaryDirectory) {
        rmSync(extracted.temporaryDirectory, { recursive: true, force: true });
      }
    }
  }
  const status =
    findings.length > 0
      ? "FAIL"
      : nested?.status === "SKIPPED"
        ? "SKIPPED"
        : "PASS";
  return result("archive", archivePath, status, findings, {
    scanned_entries: entries.length,
    nested_asar: nested
      ? {
          status: nested.status,
          scanned_entries: nested.scanned_entries,
          reason: nested.reason,
        }
      : null,
  });
}

export function auditArtifactDirectory(directory, root, policies) {
  if (!directory || !existsSync(directory)) {
    return [
      result("release-artifacts", directory ?? null, "SKIPPED", [], {
        reason: "artifact staging directory does not exist",
      }),
    ];
  }
  const checks = [];
  const entries = walkFiles(directory).filter((entry) => !entry.symbolicLink);
  const artifactEntries = entries.filter((entry) => {
    const relativePath = path
      .relative(directory, entry.absolutePath)
      .replaceAll("\\", "/");
    return (
      relativePath !== "public-source" &&
      !relativePath.startsWith("public-source/")
    );
  });
  const recognized = artifactEntries.filter((entry) =>
    /\.(?:asar|exe|zip|tgz)$/iu.test(entry.absolutePath),
  );
  const looseFindings = [];
  for (const entry of artifactEntries) {
    const relativePath = normalizeRelativePath(
      path.relative(directory, entry.absolutePath),
    );
    if (/\.(?:exe|zip|tgz|asar)$/iu.test(relativePath)) continue;
    looseFindings.push(
      ...artifactEntryFindings(relativePath, policies.denylist),
    );
    const buffer = readFileSync(entry.absolutePath);
    if (relativePath.toLowerCase().endsWith(".map")) {
      looseFindings.push(...sourceMapFindings(relativePath, buffer, policies));
    } else if (!isProbablyBinary(buffer) && buffer.length <= TEXT_SCAN_LIMIT) {
      for (const match of scanTextForPublicBoundary(
        buffer.toString("utf8"),
        relativePath,
        policies.denylist,
      )) {
        looseFindings.push({
          path: relativePath,
          rule: match.rule,
          detail: `forbidden artifact content at line ${match.line}`,
        });
      }
    }
  }
  checks.push(
    result(
      "release-artifact-files",
      directory,
      looseFindings.length === 0 ? "PASS" : "FAIL",
      looseFindings,
      { scanned_files: artifactEntries.length },
    ),
  );
  if (recognized.length === 0) {
    checks.push(
      artifactEntries.length > 0
        ? result("release-archive-containers", directory, "PASS", [], {
            reason:
              "loose artifact files were scanned directly; no archive container was expected",
          })
        : result("release-archives", directory, "SKIPPED", [], {
            reason: "artifact directory is empty",
          }),
    );
  } else {
    for (const entry of recognized) {
      checks.push(
        entry.absolutePath.toLowerCase().endsWith(".asar")
          ? auditAsarFile(entry.absolutePath, root, policies)
          : auditArchive(entry.absolutePath, root, policies),
      );
    }
  }
  return checks;
}

export function auditNpmPackagePolicy(root) {
  let packagePaths;
  try {
    packagePaths = trackedPaths(root).filter(
      (candidate) =>
        candidate === "package.json" || candidate.endsWith("/package.json"),
    );
  } catch (error) {
    return result("npm-packages", root, "SKIPPED", [], {
      reason: `Git index unavailable: ${error.message}`,
    });
  }
  const findings = [];
  let scanned = 0;
  for (const packagePath of packagePaths) {
    const absolutePath = path.join(root, packagePath);
    if (!existsSync(absolutePath)) continue;
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(absolutePath, "utf8"));
    } catch (error) {
      findings.push({
        path: packagePath,
        rule: "invalid-package-json",
        detail: error.message,
      });
      continue;
    }
    scanned += 1;
    if (
      manifest.private !== true &&
      (!Array.isArray(manifest.files) || manifest.files.length === 0)
    ) {
      findings.push({
        path: packagePath,
        rule: "npm-default-fileset",
        detail: "publishable package must declare an explicit files allowlist",
      });
    }
  }
  return result(
    "npm-packages",
    root,
    findings.length === 0 ? "PASS" : "FAIL",
    findings,
    {
      scanned_manifests: scanned,
      method:
        "package metadata surface; produced npm tarballs are scanned through --artifacts",
    },
  );
}

function parseArguments(argv) {
  const options = {
    root: repositoryRoot,
    artifacts: null,
    requireComplete: false,
    output: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--root") options.root = path.resolve(argv[++index]);
    else if (value === "--artifacts")
      options.artifacts = path.resolve(argv[++index]);
    else if (value === "--require-complete") options.requireComplete = true;
    else if (value === "--output") options.output = path.resolve(argv[++index]);
    else throw new Error(`Unknown argument: ${value}`);
  }
  return options;
}

export function auditPublicBoundary({
  root = repositoryRoot,
  artifacts = null,
  policies = loadPublicPolicies(root),
} = {}) {
  const staging = path.join(root, "release", "staging", "public-source");
  const trackedCheck = auditTrackedFiles(root, policies);
  let stagingCheck = auditSourceDirectory(staging, policies);
  if (stagingCheck.status === "SKIPPED") {
    const manifestPath = path.join(
      root,
      "release",
      "public-release-manifest.json",
    );
    if (existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
        if (manifest.generated === true) {
          stagingCheck = result(
            "public-staging",
            root,
            trackedCheck.status,
            [...trackedCheck.findings],
            {
              reason: "repository root is the generated public source",
              scanned_files: trackedCheck.scanned_files,
            },
          );
        }
      } catch {
        // The tracked source check reports malformed JSON through source policy;
        // leave this surface explicitly skipped instead of claiming it passed.
      }
    }
  }
  const checks = [
    trackedCheck,
    stagingCheck,
    auditExportInventory(root),
    auditReadmeLinks(root),
    auditDockerContext(root, policies),
    auditWebDist(root, policies),
    auditNpmPackagePolicy(root),
  ];
  const localAsar = path.join(
    root,
    "apps",
    "electron",
    "release",
    "win-unpacked",
    "resources",
    "app.asar",
  );
  if (!artifacts) {
    checks.push(
      existsSync(localAsar)
        ? auditAsarFile(localAsar, root, policies)
        : result("asar", localAsar, "SKIPPED", [], {
            reason: "desktop ASAR does not exist",
          }),
    );
  }
  if (artifacts)
    checks.push(...auditArtifactDirectory(artifacts, root, policies));
  const failed = checks.filter((check) => check.status === "FAIL").length;
  const skipped = checks.filter((check) => check.status === "SKIPPED").length;
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    root,
    policy: "default-deny",
    summary: failed > 0 ? "FAIL" : skipped > 0 ? "INCOMPLETE" : "PASS",
    totals: { checks: checks.length, failed, skipped },
    checks,
  };
}

function isMain(metaUrl) {
  return (
    Boolean(process.argv[1]) && metaUrl === pathToFileURL(process.argv[1]).href
  );
}

if (isMain(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const report = auditPublicBoundary(options);
    const serialized = `${JSON.stringify(portablePublicReport(report, options.root), null, 2)}\n`;
    if (options.output) writeFileSync(options.output, serialized, "utf8");
    process.stdout.write(serialized);
    if (report.totals.failed > 0) process.exitCode = 1;
    else if (
      (options.requireComplete || options.artifacts !== null) &&
      report.totals.skipped > 0
    )
      process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  }
}
