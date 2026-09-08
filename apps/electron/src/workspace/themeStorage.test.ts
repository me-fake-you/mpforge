import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  readThemeFile,
  resolveThemeFilePath,
  writeThemeFile,
} from "./themeStorage";

const createWorkspace = (): string =>
  fs.mkdtempSync(path.join(os.tmpdir(), "mpforge-theme-"));

test("主题文件路径固定在工作区的隐藏目录下", () => {
  const workspace = createWorkspace();

  assert.equal(
    resolveThemeFilePath(workspace),
    path.join(workspace, ".mpforge", "themes.json"),
  );
});

test("文件不存在时读取返回 null", () => {
  const workspace = createWorkspace();

  assert.equal(readThemeFile(workspace), null);
});

test("写入时自动创建隐藏目录并可回读", () => {
  const workspace = createWorkspace();
  const content = JSON.stringify({ version: 1, workspaceId: "w1", themes: [] });

  writeThemeFile(workspace, content);

  assert.equal(fs.existsSync(path.join(workspace, ".mpforge")), true);
  assert.equal(readThemeFile(workspace), content);
});

test("重复写入覆盖旧内容", () => {
  const workspace = createWorkspace();

  writeThemeFile(workspace, "first");
  writeThemeFile(workspace, "second");

  assert.equal(readThemeFile(workspace), "second");
});
