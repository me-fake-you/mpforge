import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { resolveWorkspaceArticleDirectory } from "./articlePath";
import { setWorkspaceDir } from "./state";

test("article path resolution stays fail-closed inside the selected workspace", () => {
  const testRoot = path.join(process.cwd(), "tmp", "electron-article-path");
  fs.mkdirSync(testRoot, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(testRoot, "workspace-"));
  const articleDirectory = path.join(workspace, "content", "safe-article");
  fs.mkdirSync(articleDirectory, { recursive: true });
  fs.writeFileSync(path.join(articleDirectory, "article.md"), "# Safe\n");
  setWorkspaceDir(workspace);
  try {
    assert.equal(
      resolveWorkspaceArticleDirectory("content/safe-article/article.md"),
      fs.realpathSync(articleDirectory),
    );
    assert.throws(
      () => resolveWorkspaceArticleDirectory("../outside/article.md"),
      /PATH_OUTSIDE_WORKSPACE/,
    );
    assert.throws(
      () =>
        resolveWorkspaceArticleDirectory("content/safe-article/not-article.md"),
      /INVALID_ARTICLE_PATH/,
    );
  } finally {
    setWorkspaceDir(null);
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
