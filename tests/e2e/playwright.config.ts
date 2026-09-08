import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";
import path from "node:path";

const repositoryRoot = path.resolve(__dirname, "../..");
process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.join(
  repositoryRoot,
  ".cache/playwright",
);
const isWindows = process.platform === "win32";
const localChromium = path.join(
  repositoryRoot,
  ".cache/playwright/chromium-1234/chrome-win64/chrome.exe",
);
const webServerCommand = isWindows
  ? "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/pnpm.ps1 --filter @mpforge/web exec vite --host 127.0.0.1 --port 4173 --strictPort"
  : "pnpm --filter @mpforge/web exec vite --host 127.0.0.1 --port 4173 --strictPort";

export default defineConfig({
  testDir: path.join(repositoryRoot, "tests/e2e"),
  testMatch: "**/*.spec.ts",
  outputDir: path.join(repositoryRoot, "output/playwright/test-results"),
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ["list"],
    [
      "html",
      {
        open: "never",
        outputFolder: path.join(repositoryRoot, "output/playwright/report"),
      },
    ],
  ],
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://127.0.0.1:4173",
    serviceWorkers: "block",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
  },
  webServer: {
    command: webServerCommand,
    cwd: repositoryRoot,
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium-desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 960 },
        launchOptions:
          isWindows && existsSync(localChromium)
            ? { executablePath: localChromium }
            : undefined,
      },
    },
  ],
});
