import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export const forbiddenProductionPatterns = [
  "formal" + "Publish",
  "free" + "Publish",
  "publish" + "Now",
  "mass" + "Send",
  "batch" + "Send",
  "send" + "ToFollowers",
  "scheduled" + "FormalPublish",
  "/cgi-bin/free" + "publish",
  "/cgi-bin/message/mass",
];

const productionRoots = ["apps", "packages"];
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    () => [],
  );
  const files = [];
  for (const entry of entries) {
    if (["node_modules", "dist", "build", "coverage"].includes(entry.name))
      continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(absolute)));
    else files.push(absolute);
  }
  return files;
}

export async function scanForbiddenWechatCapabilities(root = repositoryRoot) {
  const violations = [];
  for (const relativeRoot of productionRoots) {
    for (const file of await walk(path.join(root, relativeRoot))) {
      if (!sourceExtensions.has(path.extname(file))) continue;
      const normalized = file.replace(/\\/g, "/");
      if (
        /(?:\.test|\.spec)\.[cm]?[jt]sx?$/.test(normalized) ||
        normalized.includes("/__fixtures__/") ||
        normalized.includes("/security-fixtures/")
      )
        continue;
      const content = await readFile(file, "utf8");
      for (const pattern of forbiddenProductionPatterns) {
        const index = content.indexOf(pattern);
        if (index < 0) continue;
        const line = content.slice(0, index).split(/\r?\n/).length;
        violations.push({
          file: path.relative(root, file).replace(/\\/g, "/"),
          line,
          pattern,
        });
      }
    }
  }
  return violations;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const violations = await scanForbiddenWechatCapabilities();
  if (violations.length) {
    console.error(JSON.stringify({ passed: false, violations }, null, 2));
    process.exitCode = 1;
  } else {
    console.log(
      JSON.stringify(
        {
          passed: true,
          scanned_roots: productionRoots,
          excluded: ["tests", "security fixtures", "documentation"],
          violations: [],
        },
        null,
        2,
      ),
    );
  }
}
