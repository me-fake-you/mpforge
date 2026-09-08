import { expect, test, type Page } from "@playwright/test";

const navigationName = "MPForge workspace";

async function openView(page: Page, name: string): Promise<void> {
  const button = page
    .getByRole("navigation", { name: navigationName })
    .getByRole("button", { name });
  await button.click();
  await expect(button).toHaveAttribute("aria-current", "page");
}

async function createArticle(page: Page): Promise<string> {
  await openView(page, "Dashboard");
  await page.getByRole("button", { name: "New article" }).click();
  await expect(page.getByLabel("MPForge 编辑器")).toBeVisible();
  const articlePath = await page.evaluate(() =>
    localStorage.getItem("wemd-last-file-path"),
  );
  expect(articlePath).toMatch(/content\/[^/]+\/article\.md$/);
  return articlePath as string;
}

async function installAssetBridge(page: Page): Promise<void> {
  await page.evaluate(() => {
    const host = window as unknown as {
      electron?: unknown;
      __round3AssetCalls?: Array<{ method: string; payload: unknown }>;
    };
    host.__round3AssetCalls = [];
    // Adding any `window.electron` object switches the editor's file-system
    // effects into desktop mode.  Keep the existing browser-backed article in
    // place and provide the listener surface expected by those effects while
    // this test exercises only the controlled asset bridge.
    localStorage.removeItem("wemd-workspace-path");
    host.electron = {
      isElectron: true,
      platform: "win32",
      fs: {
        onRefresh: () => "round3-refresh-listener",
        removeRefreshListener: () => undefined,
        onMenuNewFile: () => "round3-new-file-listener",
        onMenuSave: () => "round3-save-listener",
        onMenuSwitchWorkspace: () => "round3-workspace-listener",
        removeAllListeners: () => undefined,
      },
      assets: {
        importLocal: async (payload: unknown) => {
          host.__round3AssetCalls!.push({ method: "importLocal", payload });
          return { success: true, result: { imported: true } };
        },
        importRemote: async (payload: unknown) => {
          host.__round3AssetCalls!.push({ method: "importRemote", payload });
          return { success: true, result: { imported: true } };
        },
        scan: async (payload: unknown) => {
          host.__round3AssetCalls!.push({ method: "scan", payload });
          return { success: true, result: { scanned: true } };
        },
        optimize: async (payload: unknown) => {
          host.__round3AssetCalls!.push({ method: "optimize", payload });
          return { success: true, result: { optimized: true } };
        },
        updateRights: async (payload: unknown) => {
          host.__round3AssetCalls!.push({ method: "updateRights", payload });
          return { success: true, result: { updated: true } };
        },
      },
    };
  });
}

async function seedManifest(page: Page, articlePath: string): Promise<void> {
  const articleDirectory = articlePath.replace(/\/article\.md$/, "");
  await page.evaluate(
    async ({ directory }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("wemd-files");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = database.transaction(
            ["meta", "content"],
            "readwrite",
          );
          const meta = transaction.objectStore("meta");
          const content = transaction.objectStore("content");
          const updatedAt = new Date().toISOString();
          const records = [
            {
              path: `${directory}/assets/manifest.json`,
              content: JSON.stringify({
                schema_version: "1",
                article_id: "round3-web-assets",
                generated_at: updatedAt,
                assets: [
                  {
                    asset_id: "asset-round3-owned",
                    original_reference: "selected:owned.png",
                    local_path: "assets/originals/owned.png",
                    normalized_path: "assets/originals/owned.png",
                    source_type: "user_owned",
                    source_url: null,
                    sha256: "a".repeat(64),
                    mime_type: "image/png",
                    file_size: 8,
                    rights_status: "pending",
                    license: null,
                    creator: null,
                    attribution: null,
                    transformations: [],
                    build_outputs: [],
                  },
                ],
              }),
            },
            {
              path: `${directory}/assets/originals/owned.png`,
              content: "c3ludGhldGlj",
            },
          ];
          for (const record of records) {
            meta.put({
              path: record.path,
              updatedAt,
              size: record.content.length,
            });
            content.put(record);
          }
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
        });
      } finally {
        database.close();
      }
    },
    { directory: articleDirectory },
  );
}

test.describe("Round 3 Web Assets controlled backend bridge", () => {
  test.beforeEach(async ({ context, page }) => {
    await context.addInitScript(() => {
      if (
        sessionStorage.getItem("mpforge-round3-assets-e2e") === "initialized"
      ) {
        return;
      }
      localStorage.clear();
      sessionStorage.clear();
      sessionStorage.setItem("mpforge-round3-assets-e2e", "initialized");
    });
    await page.route(/^https?:\/\//, async (route) => {
      const url = new URL(route.request().url());
      if (["127.0.0.1", "localhost"].includes(url.hostname)) {
        await route.continue();
      } else {
        await route.abort("blockedbyclient");
      }
    });
    await page.goto("/");
    await expect(page.getByLabel("MPForge 编辑器")).toBeVisible();
  });

  test("dispatches explicit local import with provenance to the controlled backend", async ({
    page,
  }) => {
    const articlePath = await createArticle(page);
    await openView(page, "Assets");
    await installAssetBridge(page);

    await page.getByLabel("Human actor").fill("round3-human-owner");
    await page.getByLabel("Local source type").selectOption("user_owned");
    await page
      .getByLabel("I explicitly confirm this file is user-owned.")
      .check();
    await page.getByLabel("Creator").fill("Round 3 Human");
    await page.getByLabel("License").fill("User-owned");
    await page.getByLabel("Attribution").fill("Round 3 Human");
    await page
      .getByRole("button", { name: "Choose and import local image" })
      .click();
    await expect(
      page.getByText(/Local import completed through @mpforge\/media/),
    ).toBeVisible();

    const calls = await page.evaluate(
      () =>
        (window as unknown as { __round3AssetCalls: unknown[] })
          .__round3AssetCalls,
    );
    expect(calls).toEqual([
      {
        method: "importLocal",
        payload: {
          articlePath,
          importedBy: "round3-human-owner",
          sourceType: "user_owned",
          license: "User-owned",
          creator: "Round 3 Human",
          attribution: "Round 3 Human",
          userOwnedConfirmed: true,
        },
      },
    ]);
  });

  test("requires and dispatches human rights update confirmations", async ({
    page,
  }) => {
    const articlePath = await createArticle(page);
    await seedManifest(page, articlePath);
    await page.reload();
    await expect(page.getByLabel("MPForge 编辑器")).toBeVisible();
    await openView(page, "Assets");
    await expect(page.getByText("selected:owned.png").first()).toBeVisible();
    await installAssetBridge(page);
    await openView(page, "Dashboard");
    await openView(page, "Assets");

    const rights = page.getByRole("group", { name: "Human rights record" });
    await expect(rights).toBeVisible();
    await rights.locator("select").selectOption("approved");
    const save = rights.getByRole("button", { name: "Save rights record" });
    await expect(save).toBeDisabled();
    await rights.getByLabel("Human rights review confirmed").check();
    await expect(save).toBeDisabled();
    await rights.getByLabel("User ownership confirmed").check();
    await rights.getByLabel("Rights creator").fill("Round 3 Human");
    await rights.getByLabel("Rights license").fill("User-owned");
    await rights.getByLabel("Rights attribution").fill("Round 3 Human");
    await expect(save).toBeEnabled();
    await save.click();

    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as unknown as {
                __round3AssetCalls: Array<{ method: string; payload: unknown }>;
              }
            ).__round3AssetCalls,
        ),
      )
      .toEqual([
        {
          method: "updateRights",
          payload: {
            articlePath,
            assetId: "asset-round3-owned",
            rightsStatus: "approved",
            confirmedByHuman: true,
            userOwnedConfirmed: true,
            license: "User-owned",
            creator: "Round 3 Human",
            attribution: "Round 3 Human",
          },
        },
      ]);
  });
});
