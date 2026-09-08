import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function findRepositoryRoot(start = process.cwd()) {
  let current = path.resolve(start);
  while (true) {
    if (existsSync(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`Unable to find repository root from ${start}`);
    }
    current = parent;
  }
}

export function trackedFiles(root) {
  const output = execFileSync("git", ["-C", root, "ls-files", "-z"], {
    encoding: "utf8",
    windowsHide: true,
  });
  return output.split("\0").filter(Boolean);
}

export function candidateFiles(root) {
  const output = execFileSync(
    "git",
    [
      "-C",
      root,
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
    ],
    { encoding: "utf8", windowsHide: true },
  );
  return [...new Set(output.split("\0").filter(Boolean))].sort();
}

export function trackedFileSizes(root) {
  return trackedFiles(root)
    .filter((relativePath) => existsSync(path.join(root, relativePath)))
    .map((relativePath) => ({
      path: relativePath,
      bytes: statSync(path.join(root, relativePath)).size,
    }));
}

export function isExecutedDirectly(metaUrl) {
  return (
    Boolean(process.argv[1]) && metaUrl === pathToFileURL(process.argv[1]).href
  );
}

export function printIssues(label, issues) {
  if (issues.length === 0) {
    process.stdout.write(`${label}: PASS\n`);
    return 0;
  }
  process.stderr.write(`${label}: FAIL (${issues.length})\n`);
  for (const issue of issues) process.stderr.write(`- ${issue}\n`);
  return 1;
}
