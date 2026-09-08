import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "@playwright/test";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../..");
const executablePath = path.resolve(process.argv[2] ?? "");
const screenshotPath = path.resolve(process.argv[3] ?? "");
const stateRoot = path.resolve(
  process.argv[4] ?? path.join(repositoryRoot, "tmp/round4-windows-app"),
);
const privacyReportPath = path.join(
  repositoryRoot,
  "reports/round4-evidence-privacy.json",
);

if (!existsSync(executablePath)) {
  throw new Error(`Windows executable is missing: ${executablePath}`);
}
if (
  !screenshotPath.startsWith(
    path.join(repositoryRoot, "artifacts/evidence/round-4") + path.sep,
  )
) {
  throw new Error("Screenshot output must stay inside Round 4 evidence.");
}
if (!stateRoot.startsWith(path.join(repositoryRoot, "tmp") + path.sep)) {
  throw new Error("Application state must stay inside the project tmp folder.");
}

mkdirSync(path.dirname(screenshotPath), { recursive: true });
mkdirSync(path.join(stateRoot, "Roaming"), { recursive: true });
mkdirSync(path.join(stateRoot, "Local"), { recursive: true });

const externalRequests = [];
const electronApp = await electron.launch({
  executablePath,
  args: ["--disable-gpu"],
  env: {
    ...process.env,
    APPDATA: path.join(stateRoot, "Roaming"),
    LOCALAPPDATA: path.join(stateRoot, "Local"),
    MPFORGE_NETWORK_MODE: "mock-only",
    MPFORGE_REAL_WECHAT_DISABLED: "true",
    MPFORGE_DEMO_MODE: "true",
    MPFORGE_GITHUB_REPOSITORY: "",
  },
  timeout: 45_000,
});

try {
  const runtimeVersion = await electronApp.evaluate(
    () => process.versions.electron,
  );
  const expectedRuntime = JSON.parse(
    readFileSync(
      path.join(repositoryRoot, "apps/electron/package.json"),
      "utf8",
    ),
  ).devDependencies.electron;
  if (runtimeVersion !== expectedRuntime)
    throw new Error(
      "Packaged Electron runtime differs from the exact version pin",
    );
  const context = electronApp.context();
  context.on("request", (request) => {
    const url = request.url();
    if (/^https?:\/\//iu.test(url)) externalRequests.push(url);
  });
  const page = await electronApp.firstWindow({ timeout: 45_000 });
  try {
    await page.locator(".public-demo-banner").waitFor({ timeout: 45_000 });
  } catch (error) {
    const diagnosticPath = path.join(stateRoot, "window-diagnostic.png");
    await page.screenshot({ path: diagnosticPath, fullPage: true });
    process.stderr.write(
      `${JSON.stringify({
        diagnostic: diagnosticPath,
        url: page.url(),
        title: await page.title(),
        visible_text: (await page.locator("body").innerText()).slice(0, 2_000),
      })}\n`,
    );
    throw error;
  }
  const workspaceNavigation = page.getByRole("navigation", {
    name: "MPForge workspace",
  });
  await workspaceNavigation.waitFor({ timeout: 45_000 });
  await workspaceNavigation.getByRole("button", { name: "Dashboard" }).click();
  await page
    .getByRole("heading", { name: /Reviewable work/iu })
    .waitFor({ timeout: 45_000 });
  const visibleText = await page.locator("body").innerText();
  const privacyPatterns = [
    /C:\\Users\\/iu,
    /E:\\/iu,
    /17874/u,
    /(?:access[_ -]?token|appsecret|cookie)\s*[:=]\s*\S+/iu,
    /\b1[3-9]\d{9}\b/u,
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu,
  ];
  const privacyFindings = privacyPatterns
    .filter((pattern) => pattern.test(visibleText))
    .map((pattern) => pattern.source);

  await page.screenshot({
    path: screenshotPath,
    animations: "disabled",
    fullPage: true,
  });

  const report = JSON.parse(readFileSync(privacyReportPath, "utf8"));
  const screenshot = readFileSync(screenshotPath);
  const filename = path.basename(screenshotPath);
  report.desktop_runtime_version = runtimeVersion;
  report.desktop_verified_at = new Date().toISOString();
  report.screenshots = [
    ...report.screenshots.filter((entry) => entry.filename !== filename),
    {
      filename,
      size: screenshot.length,
      sha256: createHash("sha256").update(screenshot).digest("hex"),
    },
  ];
  report.external_requests_observed = [
    ...new Set([...report.external_requests_observed, ...externalRequests]),
  ];
  report.visible_text_privacy_findings = [
    ...new Set([
      ...report.visible_text_privacy_findings,
      ...privacyFindings.map((finding) => `${filename}: ${finding}`),
    ]),
  ];
  report.summary =
    report.external_requests_observed.length === 0 &&
    report.visible_text_privacy_findings.length === 0
      ? "PASS"
      : "FAIL";
  writeFileSync(
    privacyReportPath,
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );

  process.stdout.write(
    `${JSON.stringify({
      executable: path.basename(executablePath),
      screenshot: filename,
      electron: runtimeVersion,
      external_requests: externalRequests,
      privacy_findings: privacyFindings,
      summary: report.summary,
    })}\n`,
  );
  if (report.summary !== "PASS") process.exitCode = 1;
} finally {
  await electronApp.close();
}
