import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  forbiddenProductionPatterns,
  scanForbiddenWechatCapabilities,
} from "./check-forbidden-wechat-capabilities.mjs";

test("production source has no forbidden WeChat side-effect capability", async () => {
  assert.deepEqual(await scanForbiddenWechatCapabilities(), []);
});

test("scanner catches every forbidden production pattern", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mpforge-forbidden-scan-"));
  try {
    await mkdir(path.join(root, "packages", "fixture", "src"), {
      recursive: true,
    });
    await writeFile(
      path.join(root, "packages", "fixture", "src", "unsafe.ts"),
      forbiddenProductionPatterns.join("\n"),
      "utf8",
    );
    const violations = await scanForbiddenWechatCapabilities(root);
    assert.deepEqual(
      new Set(violations.map((item) => item.pattern)),
      new Set(forbiddenProductionPatterns),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
