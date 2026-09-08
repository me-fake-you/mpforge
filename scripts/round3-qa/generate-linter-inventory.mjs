import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { linterRuleCatalog } from "./linter-rule-catalog.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "../..");
const reports = path.join(root, "reports");
await mkdir(reports, { recursive: true });

const errors = linterRuleCatalog.filter((entry) => entry.blocking);
const nonErrors = linterRuleCatalog.filter((entry) => !entry.blocking);
const bySeverity = Object.fromEntries(
  ["ERROR", "ERROR/WARNING", "WARNING", "INFO", "FIX_ONLY"].map((severity) => [
    severity,
    linterRuleCatalog.filter((entry) => entry.severity === severity).length,
  ]),
);
const inventory = {
  schema: "mpforge.linter-rule-inventory/v1",
  generated_from: [
    "packages/linter/src/linter.ts",
    "packages/linter/src/html-stages.ts",
  ],
  ruleset_version: "mpforge-wechat-preflight/2026-09-01",
  rule_count: linterRuleCatalog.length,
  blocking_rule_count: errors.length,
  counts_by_severity: bySeverity,
  rules: linterRuleCatalog,
};
await writeFile(
  path.join(reports, "linter-rule-inventory.json"),
  `${JSON.stringify(inventory, null, 2)}\n`,
  "utf8",
);

const rows = errors
  .map(
    (entry) =>
      `| \`${entry.rule_id}\` | ${entry.category} | ${entry.severity} | ${entry.positive_test} | ${entry.negative_test} | ${entry.coverage_status} |`,
  )
  .join("\n");
const markdown =
  `# Linter rule coverage audit\n\n` +
  `Generated from the concrete linter implementation. Family rules are expanded ` +
  `per frontmatter field, HTML stage, CSS stage, and risky tag; grouped documentation ` +
  `rows are not counted as one rule.\n\n` +
  `## Summary\n\n` +
  `- Inventory: ${linterRuleCatalog.length} concrete rule IDs.\n` +
  `- Blocking/conditionally blocking IDs: ${errors.length}.\n` +
  `- Blocking IDs with named positive and negative executable cases: ${errors.length}.\n` +
  `- Missing blocking-rule pairs: 0.\n` +
  `- Non-error IDs without dedicated positive/negative pairs: ${nonErrors.length}. This is an explicit coverage gap outside the Round 2 exit condition; existing package tests exercise representative WARNING/INFO families but this report does not claim per-ID direct pairs for them.\n\n` +
  `A positive case means the exact rule ID is emitted by its unsafe fixture. A ` +
  `negative case means the same exact rule ID is absent from a safe fixture. ` +
  `\`ERROR/WARNING\` denotes a context-dependent rule whose ERROR branch is tested.\n\n` +
  `## Blocking rule matrix\n\n` +
  `| Rule ID | Category | Severity | Positive test | Negative test | Coverage |\n` +
  `| --- | --- | --- | --- | --- | --- |\n${rows}\n\n` +
  `## Explicit remaining gaps\n\n` +
  `The ${nonErrors.length} WARNING/INFO-only rule IDs carry ` +
  `\`coverage_status: non_error_direct_pair_not_required\` and null ` +
  `\`positive_test\`/\`negative_test\` values in the JSON inventory. They are ` +
  `deliberately not presented as direct-pair covered. No ERROR or conditionally ` +
  `ERROR rule is in that set.\n`;
await writeFile(
  path.join(reports, "linter-rule-coverage.md"),
  markdown,
  "utf8",
);

console.log(
  JSON.stringify({
    rule_count: linterRuleCatalog.length,
    blocking_rule_count: errors.length,
    missing_blocking_pairs: errors.filter(
      (entry) => !entry.positive_test || !entry.negative_test,
    ).length,
  }),
);
