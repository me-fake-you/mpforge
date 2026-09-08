import type { IpcMainInvokeEvent } from "electron";
import { ipcMain } from "electron";
import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import * as path from "node:path";
import { resolveWorkspaceArticleDirectory } from "../workspace/articlePath";

interface ReviewPayload {
  articlePath: string;
}

interface PreviewEntry {
  screenshot?: unknown;
  screenshot_sha256?: unknown;
}

interface PreviewReportRecord {
  schema?: unknown;
  preview_version?: unknown;
  screenshot?: unknown;
  previews?: unknown;
  [key: string]: unknown;
}

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function png(bytes: Buffer): boolean {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  );
}

export async function loadChromiumPreview(articlePath: string): Promise<{
  report: PreviewReportRecord;
  screenshots: Array<{
    name: string;
    sha256: string;
    dataUrl: string;
  }>;
}> {
  const articleDirectory = resolveWorkspaceArticleDirectory(articlePath);
  const buildDirectory = await realpath(path.join(articleDirectory, "build"));
  if (!inside(articleDirectory, buildDirectory)) {
    throw new Error(
      "PREVIEW_PATH_ESCAPE: Build directory escaped the article.",
    );
  }
  const reportPath = await realpath(
    path.join(buildDirectory, "preview-report.json"),
  );
  if (!inside(buildDirectory, reportPath)) {
    throw new Error(
      "PREVIEW_PATH_ESCAPE: Preview report escaped the build directory.",
    );
  }
  const report = JSON.parse(
    await readFile(reportPath, "utf8"),
  ) as PreviewReportRecord;
  if (
    report.schema !== "mpforge.preview/v1" ||
    typeof report.preview_version !== "string" ||
    !report.preview_version.startsWith("mpforge-preview/")
  ) {
    throw new Error(
      "PREVIEW_NOT_CHROMIUM: Run the project Chromium preview command.",
    );
  }
  if (!Array.isArray(report.screenshot) || report.screenshot.length === 0) {
    throw new Error(
      "PREVIEW_SCREENSHOTS_EMPTY: Chromium screenshot evidence is required.",
    );
  }
  if (!Array.isArray(report.previews) || report.previews.length === 0) {
    throw new Error(
      "PREVIEW_ENTRIES_EMPTY: Chromium preview measurements are required.",
    );
  }
  const entries = report.previews as PreviewEntry[];
  const screenshots = [];
  for (const value of report.screenshot) {
    if (
      typeof value !== "string" ||
      value !== path.basename(value) ||
      !/^preview-[a-z0-9-]+\.png$/.test(value)
    ) {
      throw new Error(
        "INVALID_SCREENSHOT_PATH: Preview screenshot name is unsafe.",
      );
    }
    const screenshotPath = await realpath(path.join(buildDirectory, value));
    if (!inside(buildDirectory, screenshotPath)) {
      throw new Error(
        "PREVIEW_PATH_ESCAPE: Screenshot escaped the build directory.",
      );
    }
    const fileStat = await stat(screenshotPath);
    if (!fileStat.isFile() || fileStat.size > 25 * 1024 * 1024) {
      throw new Error(
        "INVALID_SCREENSHOT_FILE: Screenshot is absent or too large.",
      );
    }
    const bytes = await readFile(screenshotPath);
    if (!png(bytes)) {
      throw new Error(
        "INVALID_SCREENSHOT_MIME: Chromium evidence must be PNG.",
      );
    }
    const digest = createHash("sha256").update(bytes).digest("hex");
    const entry = entries.find((candidate) => candidate.screenshot === value);
    if (!entry || entry.screenshot_sha256 !== digest) {
      throw new Error(
        "SCREENSHOT_HASH_MISMATCH: Screenshot evidence was modified.",
      );
    }
    screenshots.push({
      name: value,
      sha256: digest,
      dataUrl: `data:image/png;base64,${bytes.toString("base64")}`,
    });
  }
  return { report, screenshots };
}

export function registerReviewHandlers(): void {
  ipcMain.handle(
    "review:load-preview",
    async (_event: IpcMainInvokeEvent, payload: ReviewPayload) => {
      try {
        return {
          success: true,
          result: await loadChromiumPreview(payload?.articlePath),
        };
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message.replace(/[\r\n]+/g, " ").slice(0, 500)
            : "Preview evidence could not be loaded.";
        return { success: false, error: message };
      }
    },
  );
}
