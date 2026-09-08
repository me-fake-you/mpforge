import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { round3ScenarioMatrix } from "../../scripts/round3-qa/scenario-matrix.mjs";

const root = path.resolve(import.meta.dirname, "../..");

test("coverage matrix contains all 32 required scenarios", () => {
  assert.ok(round3ScenarioMatrix.length >= 32);
  const ids = new Set(round3ScenarioMatrix.map((scenario) => scenario.id));
  for (let index = 1; index <= 32; index += 1) {
    assert.ok(ids.has(`R3-${String(index).padStart(2, "0")}`));
  }
  assert.equal(ids.size, round3ScenarioMatrix.length);
});

test("every automated claim points to inspectable test or scan source", async () => {
  for (const scenario of round3ScenarioMatrix) {
    assert.equal(scenario.status, "AUTOMATED", `${scenario.id} is unresolved`);
    assert.ok(
      scenario.command.trim(),
      `${scenario.id} has no runnable command`,
    );
    assert.ok(
      scenario.evidence.length > 0,
      `${scenario.id} has no evidence target`,
    );
    for (const evidence of scenario.evidence) {
      const source = await readFile(path.join(root, evidence.file), "utf8");
      assert.ok(
        source.includes(evidence.pattern),
        `${scenario.id} evidence pattern missing: ${evidence.file} :: ${evidence.pattern}`,
      );
    }
  }
});

test("no screenshot is used as proof of an automated scenario", () => {
  for (const scenario of round3ScenarioMatrix) {
    for (const evidence of scenario.evidence) {
      assert.doesNotMatch(evidence.file, /\.(?:png|jpe?g|webp)$/i);
    }
  }
});
