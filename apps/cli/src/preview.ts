import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Browser, type Page } from "playwright-core";
import { inspectSvgSafety } from "@mpforge/media";
import { CliError, type ArticleContext, type RenderResult } from "./cli.js";

export interface PreviewImages {
  light: string;
  dark: string;
}

function projectChromiumCandidates(): string[] {
  const configured = process.env.MPFORGE_CHROMIUM_EXECUTABLE;
  const playwrightDefault = chromium.executablePath();
  const localWindows = path.join(
    process.cwd(),
    ".cache",
    "playwright",
    "chromium-1234",
    "chrome-win64",
    "chrome.exe",
  );
  return [configured, playwrightDefault, localWindows].filter(
    (candidate): candidate is string => Boolean(candidate),
  );
}

export function resolvePreviewBrowser(): string | undefined {
  return projectChromiumCandidates().find((candidate) => existsSync(candidate));
}

async function denyExternalRequests(page: Page): Promise<void> {
  await page.route(/^https?:\/\//, async (route) => {
    await route.abort("blockedbyclient");
  });
}

function previewMimeType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".gif") return "image/gif";
  if (extension === ".webp") return "image/webp";
  if (extension === ".svg") return "image/svg+xml";
  throw new CliError(
    "PREVIEW_ASSET_UNSUPPORTED",
    `Preview asset has an unsupported extension: ${extension || "<none>"}`,
  );
}

async function inlineLocalImages(
  html: string,
  articleDirectory: string,
): Promise<string> {
  const imagePattern = /(<img\b[^>]*\bsrc\s*=\s*)(["'])([^"']+)\2/gi;
  const sources = [...html.matchAll(imagePattern)].map((match) => match[3]);
  const replacements = new Map<string, string>();
  for (const source of new Set(sources)) {
    if (/^(?:data:|https?:|\/\/)/i.test(source)) continue;
    const rawPath = decodeURIComponent(source.split(/[?#]/, 1)[0]);
    const absolutePath = path.resolve(articleDirectory, rawPath);
    const relative = path.relative(articleDirectory, absolutePath);
    if (
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new CliError(
        "PREVIEW_ASSET_OUTSIDE_ARTICLE",
        `Preview asset must stay inside the article directory: ${source}`,
      );
    }
    const bytes = await readFile(absolutePath).catch((cause: unknown) => {
      throw new CliError(
        "PREVIEW_ASSET_LOAD_FAILED",
        `Preview asset is missing or unreadable: ${source}; ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    });
    const mimeType = previewMimeType(absolutePath);
    if (mimeType === "image/svg+xml") {
      const safety = inspectSvgSafety(bytes);
      if (!safety.safe) {
        throw new CliError(
          "PREVIEW_UNSAFE_SVG",
          `Preview SVG rejected: ${safety.issues.join("; ")}`,
        );
      }
    }
    replacements.set(
      source,
      `data:${mimeType};base64,${bytes.toString("base64")}`,
    );
  }
  return html.replace(
    imagePattern,
    (match, prefix: string, quote: string, source: string) =>
      replacements.has(source)
        ? `${prefix}${quote}${replacements.get(source)}${quote}`
        : match,
  );
}

async function capture(
  browser: Browser,
  html: string,
  mode: "light" | "dark",
  destination: string,
  articleDirectory: string,
): Promise<void> {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    colorScheme: mode,
  });
  try {
    await denyExternalRequests(page);
    const baseHref = pathToFileURL(articleDirectory + path.sep).href;
    const previewHtml = (
      await inlineLocalImages(html, articleDirectory)
    ).replace(
      /<head(\s[^>]*)?>/i,
      (head) => `${head}<base href="${baseHref}">`,
    );
    await page.setContent(previewHtml, { waitUntil: "load" });
    await page.evaluate(async () => document.fonts.ready);
    const failedImages = await page
      .locator("img")
      .evaluateAll((images) =>
        images
          .filter((image) => (image as HTMLImageElement).naturalWidth === 0)
          .map((image) => image.getAttribute("src") ?? "<missing src>"),
      );
    if (failedImages.length > 0) {
      throw new CliError(
        "PREVIEW_ASSET_LOAD_FAILED",
        `Preview could not load: ${failedImages.join(", ")}`,
      );
    }
    await page.screenshot({
      path: destination,
      animations: "disabled",
      fullPage: true,
      type: "png",
    });
  } finally {
    await page.close();
  }
}

export async function capturePreviewImages(
  article: ArticleContext,
  light: RenderResult,
  dark: RenderResult,
): Promise<PreviewImages> {
  const executablePath = resolvePreviewBrowser();
  if (!executablePath) {
    throw new CliError(
      "PREVIEW_BROWSER_UNAVAILABLE",
      "Project-local Chromium is unavailable. Restore the recorded Playwright browser archive before running preview.",
    );
  }

  const buildDirectory = path.join(article.articleDirectory, "build");
  const destinations: PreviewImages = {
    light: path.join(buildDirectory, "preview-light.png"),
    dark: path.join(buildDirectory, "preview-dark.png"),
  };
  await mkdir(buildDirectory, { recursive: true });

  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ executablePath, headless: true });
    await capture(
      browser,
      light.documentHtml ?? light.html,
      "light",
      destinations.light,
      article.articleDirectory,
    );
    await capture(
      browser,
      dark.documentHtml ?? dark.html,
      "dark",
      destinations.dark,
      article.articleDirectory,
    );
    return destinations;
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError(
      "PREVIEW_CAPTURE_FAILED",
      `Preview capture failed safely: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    await browser?.close();
  }
}
