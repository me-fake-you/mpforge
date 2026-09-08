import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, _electron as electron } from "playwright";
import { startMockWechatServer } from "../../apps/mock-wechat/dist/server.js";
import { findRepositoryRoot } from "../qa-lib.mjs";

const root = findRepositoryRoot();
const evidenceDirectory = path.join(root, "artifacts", "evidence", "round-3");
const electronExecutable = path.join(
  root,
  "node_modules",
  ".pnpm",
  "electron@28.3.3",
  "node_modules",
  "electron",
  "dist",
  "electron.exe",
);
const chromiumExecutable = path.join(
  root,
  ".cache",
  "playwright",
  "chromium-1234",
  "chrome-win64",
  "chrome.exe",
);

async function json(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function operationWithStatus(status) {
  const operationRoot = path.join(root, "operations");
  for (const entry of await readdir(operationRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(operationRoot, entry.name);
    const current = await json(path.join(directory, "status.json")).catch(
      () => null,
    );
    if (current?.status === status) {
      return {
        directory,
        id: entry.name,
        plan: await json(path.join(directory, "plan.json")),
        status: current,
      };
    }
  }
  throw new Error(`No operation with status ${status}`);
}

async function capture(locator, name) {
  await locator.scrollIntoViewIfNeeded();
  await locator.screenshot({
    path: path.join(evidenceDirectory, name),
    animations: "disabled",
  });
}

async function openWorkspaceView(page, label) {
  const button = page
    .getByRole("navigation", { name: "MPForge workspace" })
    .getByRole("button", { name: label });
  await button.click();
  await button.waitFor({ state: "visible" });
}

function normalizedFilePath(value) {
  return String(value ?? "")
    .replace(/\\/g, "/")
    .toLowerCase();
}

async function selectReleaseArticle(page, workspace) {
  const expectedPath = normalizedFilePath(
    path.join(workspace, "content", "release-ready-article", "article.md"),
  );
  await openWorkspaceView(page, "Dashboard");
  const articles = page.getByRole("button", {
    name: /一次可复核的本地草稿演练/,
  });
  await articles.first().waitFor({ state: "visible" });
  const count = await articles.count();
  for (let index = 0; index < count; index += 1) {
    await articles.nth(index).click();
    await page.getByLabel("MPForge 编辑器").waitFor({ state: "visible" });
    await page.waitForTimeout(750);
    const selectedPath = normalizedFilePath(
      await page.evaluate(() =>
        window.localStorage.getItem("wemd-last-file-path"),
      ),
    );
    if (selectedPath === expectedPath) {
      await page.waitForTimeout(750);
      return;
    }
    await openWorkspaceView(page, "Dashboard");
  }
  throw new Error(`Release article was not found at ${expectedPath}`);
}

async function setWorkspace(page, workspace) {
  const result = await page.evaluate(async (nextWorkspace) => {
    const response = (await window.electron?.fs.setWorkspace?.(
      nextWorkspace,
    )) ?? {
      success: false,
      error: "Electron workspace bridge unavailable",
    };
    if (response.success) {
      window.localStorage.setItem("wemd-workspace-path", nextWorkspace);
      window.localStorage.removeItem("wemd-last-file-path");
    }
    return response;
  }, workspace);
  if (!result?.success) {
    throw new Error(
      `Workspace selection failed: ${result?.error ?? "unknown"}`,
    );
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  await page
    .getByRole("navigation", { name: "MPForge workspace" })
    .waitFor({ state: "visible" });
}

await mkdir(evidenceDirectory, { recursive: true });
const protectedEvidenceInputs = new Map();
for (const relativePath of [
  "content/release-ready-article/article.md",
  "content/release-ready-article/assets/manifest.json",
  "content/release-ready-article/build/lint-report.json",
  "content/release-ready-article/build/preview-report.json",
  "content/release-ready-article/history/approvals.jsonl",
  "content/release-ready-article/history/approval-invalidations.jsonl",
]) {
  const absolutePath = path.join(root, relativePath);
  protectedEvidenceInputs.set(absolutePath, await readFile(absolutePath));
}
const succeeded = await operationWithStatus("SUCCEEDED");
const reconciled = await operationWithStatus("RECONCILED_SUCCEEDED");
const successReceipt = await json(
  path.join(succeeded.directory, "receipt.json"),
);
const persistedRemoteUrl = new URL(successReceipt.remote_assets[0].remote_url);
const mockServer = await startMockWechatServer({
  port: Number(persistedRemoteUrl.port),
  dataDir: path.join(root, "tmp", "mock-wechat", "local-mock"),
  projectRoot: root,
});

let desktop;
let browser;
try {
  desktop = await electron.launch({
    executablePath: electronExecutable,
    args: [path.join(root, "apps", "electron")],
    cwd: root,
    env: {
      ...process.env,
      ELECTRON_START_URL: "http://127.0.0.1:4173",
      MPFORGE_GITHUB_REPOSITORY: "",
      MPFORGE_NETWORK_MODE: "mock-only",
      MPFORGE_REAL_WECHAT_DISABLED: "true",
    },
  });
  desktop.process().stdout?.pipe(process.stdout);
  desktop.process().stderr?.pipe(process.stderr);
  const page = await desktop.firstWindow();
  page.on("console", (message) =>
    process.stdout.write(`[renderer:${message.type()}] ${message.text()}\n`),
  );
  page.on("pageerror", (error) =>
    process.stderr.write(`[renderer:error] ${error.message}\n`),
  );
  await desktop.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.unmaximize();
    window.setSize(1440, 960);
    window.center();
  });
  await setWorkspace(page, root);
  await selectReleaseArticle(page, root);

  await openWorkspaceView(page, "Assets");
  await page.getByRole("heading", { name: /一次可复核.*assets/ }).waitFor();
  await capture(
    page.getByLabel("Asset import controls"),
    "web-assets-import.png",
  );
  const rights = page.getByRole("group", { name: "Human rights record" });
  await rights.waitFor({ state: "visible" });
  await capture(rights, "web-assets-rights.png");

  await openWorkspaceView(page, "Review");
  await page.getByLabel("Review evidence").waitFor({ state: "visible" });
  const currentChecklistText = await page
    .locator(".workspace-hub__checklist")
    .innerText();
  if (
    !currentChecklistText.includes("Linter: 0 ERROR") ||
    !currentChecklistText.includes("Chromium preview verified") ||
    currentChecklistText.includes("STALE")
  ) {
    throw new Error(
      `Expected current release evidence before capture, got: ${currentChecklistText}`,
    );
  }
  await capture(
    page.locator(".workspace-hub__split"),
    "web-preview-report.png",
  );

  await openWorkspaceView(page, "Publish");
  await page.getByRole("heading", { name: "Accounts" }).waitFor();
  await page.getByRole("button", { name: "Mock Draft" }).click();
  const mockPane = page.getByLabel("Mock Draft workspace");
  await mockPane
    .locator("label.round3-draft__control select")
    .first()
    .selectOption(succeeded.id);
  await mockPane.getByText(successReceipt.remote_draft_id).waitFor();
  await capture(
    mockPane.getByLabel("Immutable operation plan"),
    "mock-draft-plan.png",
  );
  await capture(
    mockPane.locator(".round3-draft__progress"),
    "mock-upload-progress.png",
  );
  await capture(
    mockPane.locator(".round3-draft__mock-state"),
    "mock-draft-created.png",
  );

  await page.getByRole("button", { name: "Receipt", exact: true }).click();
  const receiptPane = page.getByLabel("Receipt workspace");
  await receiptPane
    .locator("label.round3-draft__control select")
    .first()
    .selectOption(succeeded.id);
  await receiptPane.getByText("MOCK RECEIPT").waitFor();
  await capture(
    receiptPane.locator(".round3-draft__receipt"),
    "mock-receipt.png",
  );

  await page.getByRole("button", { name: "Operations", exact: true }).click();
  const operationsPane = page.getByLabel("Operations workspace");
  await operationsPane
    .getByRole("button", { name: new RegExp(reconciled.id) })
    .click();
  await operationsPane.getByText("RECONCILED_SUCCEEDED").first().waitFor();
  const uncertainEvent = operationsPane
    .locator(".round3-draft__events article")
    .filter({ hasText: "UNKNOWN_REMOTE_STATE" });
  await capture(uncertainEvent, "unknown-remote-state.png");
  await capture(
    operationsPane.locator(".round3-draft__progress"),
    "reconciliation-success.png",
  );

  await page.getByRole("button", { name: "Real Draft Confirmation" }).click();
  const realPane = page.getByLabel("Real Draft Confirmation workspace");
  await realPane.getByRole("heading", { name: "创建微信公众号草稿" }).waitFor();
  await capture(realPane, "real-agent-blocked.png");

  const previewPath = path.join(
    root,
    "content",
    "release-ready-article",
    "build",
    "preview-report.json",
  );
  const originalPreview = await readFile(previewPath);
  try {
    const stalePreview = JSON.parse(originalPreview.toString("utf8"));
    stalePreview.source_hash = "0".repeat(64);
    await writeFile(
      previewPath,
      `${JSON.stringify(stalePreview, null, 2)}\n`,
      "utf8",
    );
    await setWorkspace(page, root);
    await selectReleaseArticle(page, root);
    await openWorkspaceView(page, "Review");
    const staleChecklist = page.locator(".workspace-hub__checklist");
    await staleChecklist.waitFor({ state: "visible" });
    const staleChecklistText = await staleChecklist.innerText();
    if (!staleChecklistText.includes("STALE")) {
      throw new Error(
        `Expected STALE preview evidence, got: ${staleChecklistText}`,
      );
    }
    await capture(
      page.locator(".workspace-hub__split"),
      "stale-plan-blocked.png",
    );
  } finally {
    await writeFile(previewPath, originalPreview);
  }

  browser = await chromium.launch({
    executablePath: chromiumExecutable,
    headless: true,
  });
  const mockPage = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  await mockPage.goto(`${mockServer.url}/admin`, { waitUntil: "networkidle" });
  await mockPage.getByText("LOCAL MOCK ONLY · 127.0.0.1").waitFor();
  await mockPage.screenshot({
    path: path.join(evidenceDirectory, "mock-admin.png"),
    fullPage: true,
  });
  await mockPage
    .getByRole("link", { name: "一次可复核的本地草稿演练" })
    .click();
  await mockPage.waitForLoadState("networkidle");
  await mockPage.screenshot({
    path: path.join(evidenceDirectory, "mock-draft-preview.png"),
    fullPage: true,
  });
} finally {
  await browser?.close().catch(() => undefined);
  await desktop?.close().catch(() => undefined);
  await mockServer.close().catch(() => undefined);
}

for (const [absolutePath, originalContent] of protectedEvidenceInputs) {
  const currentContent = await readFile(absolutePath);
  if (!currentContent.equals(originalContent)) {
    throw new Error(
      `Evidence capture modified protected input: ${path.relative(root, absolutePath)}`,
    );
  }
}

process.stdout.write(`Round 3 screenshots captured at ${evidenceDirectory}\n`);
