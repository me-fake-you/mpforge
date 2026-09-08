import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { linterRuleCatalog } from "../../scripts/round3-qa/linter-rule-catalog.mjs";

const inventory = JSON.parse(
  await readFile(
    new URL("../../reports/linter-rule-inventory.json", import.meta.url),
    "utf8",
  ),
);

test("inventory expands every catalog rule exactly once", () => {
  assert.equal(inventory.rule_count, linterRuleCatalog.length);
  assert.deepEqual(
    inventory.rules.map((entry) => entry.rule_id),
    linterRuleCatalog.map((entry) => entry.rule_id),
  );
  assert.equal(
    new Set(inventory.rules.map((entry) => entry.rule_id)).size,
    inventory.rule_count,
  );
});

test("every inventory row contains the required audit fields", () => {
  const fields = [
    "rule_id",
    "category",
    "severity",
    "deterministic",
    "autofix",
    "blocking",
    "implementation_file",
    "documentation",
    "positive_test",
    "negative_test",
    "coverage_status",
  ];
  for (const entry of inventory.rules) {
    for (const field of fields)
      assert.ok(Object.hasOwn(entry, field), `${entry.rule_id}: ${field}`);
  }
});

test("every ERROR-capable rule has named positive and negative coverage", () => {
  const missing = inventory.rules.filter(
    (entry) =>
      entry.blocking &&
      (!entry.positive_test ||
        !entry.negative_test ||
        entry.coverage_status !== "positive_and_negative"),
  );
  assert.deepEqual(missing, []);
});
