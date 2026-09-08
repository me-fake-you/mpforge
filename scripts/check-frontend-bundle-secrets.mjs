import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  findRepositoryRoot,
  isExecutedDirectly,
  printIssues,
} from "./qa-lib.mjs";
import { scanText } from "./check-secrets.mjs";

const FORBIDDEN_BUNDLE_MARKERS = [
  "MPFORGE_APP_SECRET",
  "MPFORGE_PERSONAL_EXAMPLE_APP_SECRET",
  "MPFORGE_MOCK_APP_SECRET",
  "MPFORGE_ACCESS_TOKEN",
];

function filesBelow(directory) {
  const files = [];
  for (const name of readdirSync(directory)) {
    const candidate = path.join(directory, name);
    const information = statSync(candidate);
    if (information.isDirectory()) files.push(...filesBelow(candidate));
    else if (information.isFile()) files.push(candidate);
  }
  return files;
}

export function scanFrontendBundle(root) {
  const directory = path.join(root, "apps", "web", "dist");
  const issues = [];
  try {
    for (const file of filesBelow(directory)) {
      const bytes = readFileSync(file);
      if (bytes.includes(0)) continue;
      const text = bytes.toString("utf8");
      const relative = path.relative(root, file).replace(/\\/gu, "/");
      for (const finding of scanText(text))
        issues.push(`${relative} [${finding.rule}] possible bundled secret`);
      for (const marker of FORBIDDEN_BUNDLE_MARKERS)
        if (text.includes(marker))
          issues.push(
            `${relative} contains forbidden credential marker ${marker}`,
          );
    }
  } catch (error) {
    if (error?.code === "ENOENT")
      return [
        "apps/web/dist is missing; build the Web app before bundle scanning",
      ];
    throw error;
  }
  return [...new Set(issues)].sort();
}

if (isExecutedDirectly(import.meta.url)) {
  const root = findRepositoryRoot();
  process.exitCode = printIssues(
    "frontend bundle secret scan",
    scanFrontendBundle(root),
  );
}
