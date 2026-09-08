import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { listArticleAssetFiles } from "./assetFiles";

test("lists only local image assets without mutating the article directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mpforge-assets-"));
  try {
    await mkdir(path.join(root, "assets"), { recursive: true });
    await mkdir(path.join(root, "build", "assets"), { recursive: true });
    await writeFile(path.join(root, "assets", "cover.svg"), "<svg/>");
    await writeFile(path.join(root, "assets", "notes.txt"), "ignore");
    await writeFile(path.join(root, "build", "assets", "cover.png"), "png");

    const files = await listArticleAssetFiles(root);

    assert.deepEqual(files.map((file) => file.name).sort(), [
      "cover.png",
      "cover.svg",
    ]);
    assert.equal(
      files.every((file) => file.isDirectory === false),
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
