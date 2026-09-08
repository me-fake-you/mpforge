import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../..");
const outputDirectory = path.resolve(
  process.argv[2] ?? path.join(repositoryRoot, "artifacts/evidence/round-4"),
);
const baseUrl = process.argv[3] ?? "http://127.0.0.1:4174";
const chromiumPath = path.join(
  repositoryRoot,
  ".cache/playwright/chromium-1234/chrome-win64/chrome.exe",
);

if (!existsSync(chromiumPath)) {
  throw new Error(
    "Project-local Chromium is missing; restore it inside .cache/playwright",
  );
}

mkdirSync(outputDirectory, { recursive: true });
const browser = await chromium.launch({ executablePath: chromiumPath });
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
  locale: "zh-CN",
  timezoneId: "Asia/Shanghai",
  serviceWorkers: "block",
});
const page = await context.newPage();
const attemptedExternalRequests = [];

await context.addInitScript(() => {
  localStorage.clear();
  sessionStorage.clear();
});
await page.route(/^https?:\/\//u, async (route) => {
  const url = new URL(route.request().url());
  if (["127.0.0.1", "localhost"].includes(url.hostname)) {
    await route.continue();
    return;
  }
  attemptedExternalRequests.push(url.origin);
  await route.abort("blockedbyclient");
});

const captured = [];
async function capture(name, locator = page) {
  const destination = path.join(outputDirectory, `${name}.png`);
  await locator.screenshot({
    path: destination,
    animations: "disabled",
    ...(locator === page ? { fullPage: true } : {}),
  });
  const bytes = readFileSync(destination);
  captured.push({
    filename: `${name}.png`,
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}

async function openView(name) {
  const navigation = page.getByRole("navigation", {
    name: "MPForge workspace",
  });
  const button = navigation.getByRole("button", { name });
  await button.click();
  await button.waitFor({ state: "visible" });
}

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByText("DEMO / MOCK", { exact: true }).waitFor();

  await openView("Dashboard");
  await page
    .getByRole("heading", { name: "Reviewable work, from source to draft." })
    .waitFor();
  await page
    .getByText("把公众号发文做成 Content-as-Code", { exact: true })
    .waitFor();
  await capture("dashboard");
  await capture("web-demo");

  await page
    .getByRole("button", { name: /把公众号发文做成 Content-as-Code/u })
    .click();
  await page.locator(".cm-editor").waitFor();
  await page.getByText("Markdown 编辑器", { exact: true }).waitFor();
  await capture("editor");

  const preview = page.locator(".preview-pane");
  await preview.waitFor();
  await page.getByRole("button", { name: "浅色", exact: true }).click();
  await capture("preview-light", preview);
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await capture("preview-dark", preview);

  await openView("Review");
  await page.getByText(/Linter:/u).waitFor();
  await capture("linter", page.locator(".workspace-hub__panel").first());
  await page.getByText("Human approval recorded", { exact: true }).waitFor();
  await capture("approval");

  await openView("Assets");
  await page.getByRole("heading", { name: /assets$/iu }).waitFor();
  await page.getByText("approved", { exact: true }).first().waitFor();
  await capture("assets");

  await openView("Publish");
  const draftTabs = page.getByRole("navigation", {
    name: "Draft pipeline workspaces",
  });
  await draftTabs.getByRole("button").first().waitFor();

  await draftTabs.getByRole("button", { name: "Operations" }).click();
  await page.getByLabel("Immutable operation plan").waitFor();
  await capture("mock-draft-plan");

  await draftTabs.getByRole("button", { name: "Mock Draft" }).click();
  const operationSelect = page
    .locator("label.round3-draft__control select")
    .first();
  await operationSelect.selectOption("demo-op-succeeded");
  await page.getByText("Remote assets recorded: 1", { exact: true }).waitFor();
  await capture("mock-upload");
  await page
    .getByText("mock-draft-demo-001", { exact: true })
    .first()
    .waitFor();
  await capture("mock-draft");

  await draftTabs.getByRole("button", { name: "Operations" }).click();
  await page.getByText(/mock\.duplicate_prevented/u).waitFor();
  await capture("mock-duplicate-prevention");

  await draftTabs.getByRole("button", { name: "Receipt" }).click();
  await page
    .locator("label.round3-draft__control select")
    .first()
    .selectOption("demo-op-succeeded");
  await page.getByText("MOCK RECEIPT", { exact: true }).waitFor();
  await capture("mock-receipt");

  await draftTabs.getByRole("button", { name: "Mock Draft" }).click();
  await page
    .locator("label.round3-draft__control select")
    .first()
    .selectOption("demo-op-unknown");
  const reconcile = page.getByRole("button", {
    name: "Reconcile UNKNOWN_REMOTE_STATE (read only)",
  });
  await reconcile.click();
  await page
    .getByText("Reconciliation: REMOTE_DRAFT_FOUND_BY_PLAN_HASH", {
      exact: true,
    })
    .waitFor();
  await capture("reconciliation");

  const visibleText = await page.locator("body").innerText();
  const forbiddenVisiblePatterns = [
    /[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/]/u,
    /(?:\/Users\/|\/home\/)[^/\s]+\//u,
    /(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}/u,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
    /\b1[3-9]\d{9}\b/u,
  ];
  const privacyFindings = forbiddenVisiblePatterns
    .map((expression) => expression.source)
    .filter((expression) => new RegExp(expression, "u").test(visibleText));
  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    source: "MPForge browser-only Demo Mode",
    network_policy: "localhost-only",
    external_requests_observed: [...new Set(attemptedExternalRequests)],
    screenshots: captured,
    visible_text_privacy_findings: privacyFindings,
    summary:
      attemptedExternalRequests.length === 0 && privacyFindings.length === 0
        ? "PASS"
        : "FAIL",
  };
  writeFileSync(
    path.join(repositoryRoot, "reports/round4-evidence-privacy.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  if (report.summary !== "PASS") {
    throw new Error(
      `Public demo privacy gate failed: ${JSON.stringify(report)}`,
    );
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await browser.close();
}
