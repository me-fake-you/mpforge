import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const navigationName = "MPForge workspace";
const publicDemoMode = process.env.MPFORGE_DEMO_MODE === "true";
const completedExternalResponses = new WeakMap<Page, string[]>();

async function capture(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  const screenshot = await page.screenshot({
    animations: "disabled",
    fullPage: true,
  });
  await testInfo.attach(name, {
    body: screenshot,
    contentType: "image/png",
  });
  if (process.env.MPFORGE_SCREENSHOT_DIR) {
    const directory = path.resolve(process.env.MPFORGE_SCREENSHOT_DIR);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, `mpforge-${name}.png`), screenshot);
  }
}

async function openView(page: Page, name: string): Promise<void> {
  const navigation = page.getByRole("navigation", { name: navigationName });
  const destination = navigation.getByRole("button", { name });
  await destination.click();
  await expect(destination).toHaveAttribute("aria-current", "page");
}

test.beforeEach(async ({ context, page }) => {
  await context.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  const externalResponses: string[] = [];
  completedExternalResponses.set(page, externalResponses);
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
      externalResponses.push(url.toString());
    }
  });
  await page.route(/^https?:\/\//, async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
      await route.continue();
      return;
    }
    await route.abort("blockedbyclient");
  });

  await page.goto("/");
  await expect(page.getByLabel("MPForge 编辑器")).toBeVisible();
});

test.afterEach(async ({ page }) => {
  expect(
    completedExternalResponses.get(page),
    "No external HTTP response may enter the deterministic E2E run",
  ).toEqual([]);
});

test("navigates the Content-as-Code workspace without weakening gates", async ({
  page,
}, testInfo) => {
  const navigation = page.getByRole("navigation", { name: navigationName });
  await expect(navigation).toBeVisible();
  await expect(navigation.getByText("Content-as-Code")).toBeVisible();

  await openView(page, "Dashboard");
  await expect(
    page.getByRole("heading", {
      name: "Reviewable work, from source to draft.",
    }),
  ).toBeVisible();
  const summary = page.getByLabel("Workspace summary");
  await expect(summary).toContainText("Articles");
  await expect(summary).toContainText("Draft");
  await expect(summary).toContainText("Reviewing / Reviewed");
  await expect(summary).toContainText("Approved");
  await expect(summary).toContainText("最近构建状态");
  await expect(summary).toContainText("未记录");
  await capture(page, testInfo, "dashboard");

  await openView(page, "Editor");
  await expect(
    page.getByText("Markdown 编辑器", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".cm-editor")).toBeVisible();
  await expect(page.locator(".markdown-preview")).toBeVisible();
  await capture(page, testInfo, "editor");

  await openView(page, "Review");
  await expect(
    page.getByRole("heading", { name: "Open an article to review" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Approve article" }),
  ).toBeDisabled();
  await expect(page.getByText("AI cannot grant approval")).toBeVisible();
  await capture(page, testInfo, "review");

  await openView(page, "Assets");
  await expect(
    page.getByRole("heading", { name: "Article assets" }),
  ).toBeVisible();
  await expect(
    page.getByText(/Network images are never imported implicitly/),
  ).toBeVisible();
  await capture(page, testInfo, "assets");

  await openView(page, "Publish");
  const draftNavigation = page.getByRole("navigation", {
    name: "Draft pipeline workspaces",
  });
  await expect(draftNavigation.getByRole("button")).toHaveCount(
    publicDemoMode ? 5 : 6,
  );
  await expect(
    page.getByRole("region", { name: "Accounts workspace" }),
  ).toBeVisible();
  if (publicDemoMode) {
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: /runs entirely in browser memory/i }),
    ).toBeVisible();
    await expect(
      draftNavigation.getByRole("button", {
        name: "Real Draft Confirmation",
      }),
    ).toHaveCount(0);
  } else {
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: /controlled desktop backend/i }),
    ).toBeVisible();
  }
  await capture(page, testInfo, "publish");

  await openView(page, "Settings");
  await expect(
    page.getByRole("heading", { name: "Workspace and safety" }),
  ).toBeVisible();
  await expect(
    page.getByText("Environment only · values never displayed"),
  ).toBeVisible();
  await capture(page, testInfo, "settings");
});

test("keeps every primary workspace destination keyboard reachable", async ({
  page,
}) => {
  const navigation = page.getByRole("navigation", { name: navigationName });
  for (const name of [
    "Dashboard",
    "Editor",
    "Review",
    "Assets",
    "Publish",
    "Settings",
  ]) {
    const destination = navigation.getByRole("button", { name });
    await destination.focus();
    await expect(destination).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(destination).toHaveAttribute("aria-current", "page");
  }
});
