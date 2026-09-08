import { expect, test, type Page } from "@playwright/test";

const navigationName = "MPForge workspace";
const attemptedExternalRequests = new WeakMap<Page, string[]>();
const articleTitle = "Round 1 可审计创作闭环";
const articleBody = [
  "# Round 1 浏览器验收",
  "",
  "这段正文必须在自动保存和整页刷新后仍然存在。",
  "",
  "> 状态机不允许从 reviewing 直接进入 approved。",
].join("\n");

async function openView(page: Page, name: string): Promise<void> {
  const navigation = page.getByRole("navigation", { name: navigationName });
  const destination = navigation.getByRole("button", { name });
  await destination.click();
  await expect(destination).toHaveAttribute("aria-current", "page");
}

async function replaceEditorDocument(
  page: Page,
  source: string,
): Promise<void> {
  const editor = page.locator(".cm-content");
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+A" : "Control+A",
  );
  await page.keyboard.insertText(source);
  await expect(editor).toContainText(
    "这段正文必须在自动保存和整页刷新后仍然存在",
  );
}

async function readStateEvents(page: Page): Promise<
  Array<{
    from_status: string;
    to_status: string;
    actor_type: string;
    source_commit: string;
  }>
> {
  const raw = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("wemd-files");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const records = await new Promise<
        Array<{ path: string; content: string }>
      >((resolve, reject) => {
        const request = database
          .transaction("content", "readonly")
          .objectStore("content")
          .getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return (
        records.find((record) =>
          /\/history\/state-events\.jsonl$/i.test(record.path),
        )?.content ?? ""
      );
    } finally {
      database.close();
    }
  });
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function readPersistenceSnapshot(page: Page): Promise<{
  lastFile: string | null;
  paths: string[];
}> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("wemd-files");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const records = await new Promise<Array<{ path: string }>>(
        (resolve, reject) => {
          const request = database
            .transaction("meta", "readonly")
            .objectStore("meta")
            .getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        },
      );
      return {
        lastFile: localStorage.getItem("wemd-last-file-path"),
        paths: records.map((record) => record.path).sort(),
      };
    } finally {
      database.close();
    }
  });
}

test.beforeEach(async ({ context, page }) => {
  await context.addInitScript(() => {
    if (sessionStorage.getItem("mpforge-round1-e2e") === "initialized") {
      return;
    }
    localStorage.clear();
    sessionStorage.clear();
    sessionStorage.setItem("mpforge-round1-e2e", "initialized");
  });

  const externalRequests: string[] = [];
  attemptedExternalRequests.set(page, externalRequests);
  await page.route(/^https?:\/\//, async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
      await route.continue();
      return;
    }
    externalRequests.push(url.toString());
    await route.abort("blockedbyclient");
  });

  await page.goto("/");
  await expect(page.getByLabel("MPForge 编辑器")).toBeVisible();
});

test.afterEach(async ({ page }) => {
  expect(
    attemptedExternalRequests.get(page),
    "The local authoring loop must not attempt an external HTTP request",
  ).toEqual([]);
});

test("creates, edits, previews, persists, and safely submits an article for review", async ({
  page,
}) => {
  await openView(page, "Dashboard");
  await page.getByRole("button", { name: "New article" }).click();

  await expect(
    page.getByText("Markdown 编辑器", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Frontmatter", { exact: true })).toBeVisible();

  await replaceEditorDocument(page, articleBody);

  const title = page.getByRole("textbox", { name: "标题" });
  await title.fill(articleTitle);
  await expect(title).toHaveValue(articleTitle);

  const theme = page.getByRole("combobox", { name: "原创主题" });
  await theme.selectOption("academic-blue");
  await expect(theme).toHaveValue("academic-blue");

  const preview = page.locator(".markdown-preview");
  await expect(preview).toHaveAttribute("data-preview-scheme", "light");
  await expect(page.getByText("模拟预览", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "深色" }).click();
  await expect(preview).toHaveAttribute("data-preview-scheme", "dark");
  await page.getByRole("button", { name: "浅色" }).click();
  await expect(preview).toHaveAttribute("data-preview-scheme", "light");

  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+S" : "Control+S",
  );
  await expect(page.locator(".save-indicator.saved")).toBeVisible({
    timeout: 10_000,
  });

  await page.getByRole("button", { name: "构建 HTML" }).click();
  await expect(page.getByRole("button", { name: "构建完成" })).toBeVisible();

  const beforeReload = await readPersistenceSnapshot(page);
  expect(beforeReload.lastFile).toMatch(/^content\/[^/]+\/article\.md$/);
  expect(beforeReload.paths).toContain(beforeReload.lastFile);

  await page.reload();
  await expect(page.getByLabel("MPForge 编辑器")).toBeVisible();
  await expect.poll(() => readPersistenceSnapshot(page)).toEqual(beforeReload);
  await expect(page.getByText("Frontmatter", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator(".cm-content")).toContainText(
    "这段正文必须在自动保存和整页刷新后仍然存在",
  );
  await expect(page.getByRole("textbox", { name: "标题" })).toHaveValue(
    articleTitle,
  );
  await expect(page.getByRole("combobox", { name: "原创主题" })).toHaveValue(
    "academic-blue",
  );

  await openView(page, "Dashboard");
  const restoredArticle = page.getByRole("button", {
    name: new RegExp(articleTitle),
  });
  await expect(restoredArticle).toBeVisible();
  await restoredArticle.click();

  await openView(page, "Review");
  await expect(page.getByText("Status: idea", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Move to draft" }).click();
  await expect(page.getByText("Status: draft", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Request review" }).click();
  await expect(
    page.getByText("Status: reviewing", { exact: true }),
  ).toBeVisible();

  const stateEvents = await readStateEvents(page);
  expect(
    stateEvents.map(({ from_status, to_status }) => ({
      from_status,
      to_status,
    })),
  ).toEqual([
    { from_status: "idea", to_status: "draft" },
    { from_status: "draft", to_status: "reviewing" },
  ]);
  expect(stateEvents.every((event) => event.actor_type === "human")).toBe(true);
  expect(
    stateEvents.every(
      (event) =>
        typeof event.source_commit === "string" &&
        event.source_commit.length > 0,
    ),
  ).toBe(true);

  const approve = page.getByRole("button", { name: "Approve article" });
  await expect(approve).toBeDisabled();
  await approve.evaluate((button: HTMLButtonElement) => button.click());
  await expect(
    page.getByText("Status: reviewing", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Human approval recorded")).toHaveCount(0);
});
