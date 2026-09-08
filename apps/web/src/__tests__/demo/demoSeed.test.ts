import { describe, expect, it } from "vitest";
import { buildDemoArticle, seedPublicDemoWorkspace } from "../../demo/demoSeed";
import type { StorageAdapter } from "../../storage/StorageAdapter";

function memoryAdapter() {
  const files = new Map<string, string>();
  const adapter: StorageAdapter = {
    type: "indexeddb",
    name: "demo-test",
    ready: true,
    async init() {
      return { ready: true };
    },
    async listFiles() {
      return [];
    },
    async readFile(path) {
      const content = files.get(path);
      if (content === undefined) throw new Error("missing");
      return content;
    },
    async writeFile(path, content) {
      files.set(path, content);
    },
    async deleteFile(path) {
      files.delete(path);
    },
    async renameFile(oldPath, newPath) {
      const content = files.get(oldPath);
      if (content === undefined) throw new Error("missing");
      files.set(newPath, content);
      files.delete(oldPath);
    },
    async exists(path) {
      return files.has(path);
    },
  };
  return { adapter, files };
}

describe("public demo workspace", () => {
  it("seeds only original Mock-safe browser files and is idempotent", async () => {
    const { adapter, files } = memoryAdapter();
    await expect(seedPublicDemoWorkspace(adapter)).resolves.toBe(true);
    await expect(seedPublicDemoWorkspace(adapter)).resolves.toBe(false);

    expect(files.get("content/content-as-code-demo/article.md")).toContain(
      "纯浏览器 DEMO / MOCK",
    );
    expect(
      files.get("content/content-as-code-demo/assets/manifest.json"),
    ).toContain('"rights_status": "approved"');
    expect([...files.values()].join("\n")).not.toMatch(
      /api\.weixin\.qq\.com|access_token|appsecret/i,
    );
  });

  it("builds a reviewed, original article without a real account", () => {
    const article = buildDemoArticle();
    expect(article).toContain('status: "approved"');
    expect(article).toContain("original: true");
    expect(article).toContain('account: "mock-account"');
  });
});
