import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { inspectHtmlStages } from "@mpforge/linter";
import { sha256 } from "@mpforge/renderer";
import {
  loadProjectPlaywright,
  resolveChromiumExecutable,
  type BrowserPageLike,
} from "./browser-loader.js";
import { detectLayoutIssues } from "./detection.js";
import { preparePreviewStages } from "./local-assets.js";
import { buildPreviewReport } from "./report.js";
import type {
  ElementSnapshot,
  GeneratePreviewInput,
  LayoutSnapshot,
  PreviewMode,
  PreviewReport,
  PreviewResult,
  PreviewStage,
  PreviewViewport,
} from "./types.js";
import {
  DEFAULT_PREVIEW_VIEWPORTS,
  WECHAT_SIMULATION_NOTICE,
} from "./types.js";

const HASH_PATTERN = /^[a-f\d]{64}$/i;
const MAX_FULL_PAGE_HEIGHT = 20_000;

function validateInput(input: GeneratePreviewInput): void {
  if (!input.articleId.trim()) throw new TypeError("articleId is required.");
  if (!HASH_PATTERN.test(input.sourceHash))
    throw new TypeError("sourceHash must be a SHA-256 hex digest.");
  if (!HASH_PATTERN.test(input.renderedHtmlHash))
    throw new TypeError("renderedHtmlHash must be a SHA-256 hex digest.");
  if (!input.outputDirectory.trim())
    throw new TypeError("outputDirectory is required.");
  for (const stages of [
    input.stages,
    ...(input.darkStages ? [input.darkStages] : []),
  ]) {
    for (const stage of ["raw", "safe", "wechat"] as const) {
      if (typeof stages[stage] !== "string")
        throw new TypeError(`${stage} HTML must be a string.`);
    }
  }
  const viewports = input.viewports ?? DEFAULT_PREVIEW_VIEWPORTS;
  if (viewports.length < 2) {
    throw new RangeError("At least two mobile preview viewports are required.");
  }
  if (
    !viewports.some((viewport) => viewport.width === 375) ||
    !viewports.some((viewport) => viewport.width === 402)
  ) {
    throw new RangeError(
      "The preview matrix must include both 375px and 402px viewport widths.",
    );
  }
  if (
    new Set(viewports.map((viewport) => `${viewport.width}x${viewport.height}`))
      .size !== viewports.length
  ) {
    throw new RangeError("Preview viewports must be unique.");
  }
  for (const viewport of viewports) {
    if (
      !viewport.name.trim() ||
      !Number.isInteger(viewport.width) ||
      !Number.isInteger(viewport.height)
    ) {
      throw new TypeError(
        "Preview viewports require a name and integer width/height.",
      );
    }
    if (
      viewport.width < 320 ||
      viewport.width > 768 ||
      viewport.height < 480 ||
      viewport.height > 1_600
    ) {
      throw new RangeError(
        `Preview viewport ${viewport.name} is outside the supported mobile range.`,
      );
    }
  }
  if (
    input.generatedAt !== undefined &&
    Number.isNaN(Date.parse(input.generatedAt))
  ) {
    throw new TypeError("generatedAt must be an ISO-compatible timestamp.");
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function stageDocument(
  html: string,
  stage: PreviewStage,
  mode: PreviewMode,
): string {
  const background = mode === "dark" ? "#111315" : "#ffffff";
  const foreground = mode === "dark" ? "#e8eaed" : "#202124";
  const head = `<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src 'none'; media-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'">
<meta name="color-scheme" content="${mode}">
<style>
html{box-sizing:border-box;background:${background};color:${foreground};color-scheme:${mode};}
*,*::before,*::after{box-sizing:inherit;}
body{margin:0;min-width:0;background:${background};color:${foreground};font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;}
#mpforge-preview-notice{position:relative;z-index:2147483647;margin:0;padding:10px 12px;border-bottom:1px solid ${mode === "dark" ? "#4b5563" : "#d1d5db"};background:${mode === "dark" ? "#1f2937" : "#f8fafc"};color:${mode === "dark" ? "#f3f4f6" : "#374151"};font-size:12px;line-height:1.5;}
#mpforge-preview-stage{display:block;font-weight:700;margin-bottom:2px;}
</style>`;
  const notice = `<aside id="mpforge-preview-notice" role="note"><span id="mpforge-preview-stage">${escapeHtml(stage)} / ${escapeHtml(mode)}</span>${WECHAT_SIMULATION_NOTICE}</aside>`;
  if (/<!doctype|<html\b/i.test(html)) {
    let document = html;
    document = /<head\b[^>]*>/i.test(document)
      ? document.replace(/<head\b[^>]*>/i, (match) => `${match}${head}`)
      : document.replace(
          /<html\b[^>]*>/i,
          (match) => `${match}<head>${head}</head>`,
        );
    document = /<body\b[^>]*>/i.test(document)
      ? document.replace(/<body\b[^>]*>/i, (match) => `${match}${notice}`)
      : document.replace(/<\/head>/i, `</head><body>${notice}`) + "</body>";
    return document;
  }
  return `<!doctype html><html lang="zh-CN"><head>${head}</head><body>${notice}<main id="mpforge-preview-content">${html}</main></body></html>`;
}

async function collectLayoutSnapshot(
  viewport: PreviewViewport,
): Promise<LayoutSnapshot> {
  const selectorFor = (element: Element): string => {
    if (element.id) return `#${CSS.escape(element.id)}`;
    const parts: string[] = [];
    let current: Element | null = element;
    while (
      current &&
      current !== document.documentElement &&
      parts.length < 6
    ) {
      let part = current.tagName.toLocaleLowerCase();
      const parent: Element | null = current.parentElement;
      if (parent) {
        const currentTag = current.tagName;
        const siblings = [...parent.children].filter(
          (candidate) => candidate.tagName === currentTag,
        );
        if (siblings.length > 1)
          part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      }
      parts.unshift(part);
      current = parent;
    }
    return parts.join(" > ");
  };

  const imageAnalysis = (
    image: HTMLImageElement,
  ): Pick<
    ElementSnapshot,
    | "image_has_transparency"
    | "image_average_luminance"
    | "image_analysis_error"
  > => {
    if (
      !image.complete ||
      image.naturalWidth === 0 ||
      image.naturalHeight === 0
    ) {
      return {
        image_has_transparency: null,
        image_average_luminance: null,
        image_analysis_error: null,
      };
    }
    try {
      const canvas = document.createElement("canvas");
      canvas.width = Math.min(32, image.naturalWidth);
      canvas.height = Math.min(32, image.naturalHeight);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Canvas context unavailable");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let transparent = false;
      let luminanceTotal = 0;
      let opaquePixels = 0;
      for (let index = 0; index < data.length; index += 4) {
        const alpha = data[index + 3] / 255;
        if (alpha < 0.98) transparent = true;
        if (alpha > 0.05) {
          luminanceTotal +=
            (0.2126 * data[index] +
              0.7152 * data[index + 1] +
              0.0722 * data[index + 2]) /
            255;
          opaquePixels += 1;
        }
      }
      return {
        image_has_transparency: transparent,
        image_average_luminance:
          opaquePixels > 0
            ? Number((luminanceTotal / opaquePixels).toFixed(4))
            : 0,
        image_analysis_error: null,
      };
    } catch (error) {
      return {
        image_has_transparency: null,
        image_average_luminance: null,
        image_analysis_error:
          error instanceof Error ? error.message : String(error),
      };
    }
  };

  const effectiveBackground = (element: Element): string => {
    let current: Element | null = element;
    while (current) {
      const color = getComputedStyle(current).backgroundColor;
      const alpha = color.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/)?.[1];
      if (alpha === undefined || Number(alpha) > 0) return color;
      current = current.parentElement;
    }
    return getComputedStyle(document.body).backgroundColor;
  };

  const elements = [...document.querySelectorAll("body, body *")]
    .slice(0, 2_000)
    .map((element): ElementSnapshot => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const image = element instanceof HTMLImageElement ? element : null;
      const analyzed = image
        ? imageAnalysis(image)
        : {
            image_has_transparency: null,
            image_average_luminance: null,
            image_analysis_error: null,
          };
      return {
        selector: selectorFor(element),
        parent_selector: element.parentElement
          ? selectorFor(element.parentElement)
          : null,
        tag: element.tagName.toLocaleLowerCase(),
        text: (element.textContent ?? "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 240),
        rect: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          left: rect.left,
        },
        client_width: (element as HTMLElement).clientWidth,
        client_height: (element as HTMLElement).clientHeight,
        scroll_width: (element as HTMLElement).scrollWidth,
        scroll_height: (element as HTMLElement).scrollHeight,
        display: style.display,
        visibility: style.visibility,
        opacity: Number(style.opacity),
        overflow_x: style.overflowX,
        overflow_y: style.overflowY,
        position: style.position,
        color: style.color,
        background_color: effectiveBackground(element),
        font_size: Number.parseFloat(style.fontSize) || 0,
        font_weight:
          Number.parseInt(style.fontWeight, 10) ||
          (style.fontWeight === "bold" ? 700 : 400),
        natural_width: image?.naturalWidth ?? null,
        natural_height: image?.naturalHeight ?? null,
        image_complete: image?.complete ?? null,
        ...analyzed,
      };
    });
  const root = document.documentElement;
  const body = document.body;
  return {
    viewport,
    document_scroll_width: root.scrollWidth,
    document_scroll_height: root.scrollHeight,
    body_scroll_width: body.scrollWidth,
    body_scroll_height: body.scrollHeight,
    elements,
  };
}

function screenshotName(
  stage: PreviewStage,
  mode: PreviewMode,
  viewport: PreviewViewport,
): string {
  const suffix = viewport.width === 375 ? "" : `-${viewport.width}`;
  return `preview-${stage}-${mode}${suffix}.png`;
}

function sha256Bytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function renderOne(
  page: BrowserPageLike,
  html: string,
  stage: PreviewStage,
  mode: PreviewMode,
  viewport: PreviewViewport,
  outputDirectory: string,
  screenshot: string,
  generatedAt: string,
  sourceHash: string,
  renderedHtmlHash: string,
): Promise<PreviewResult> {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route(/^https?:\/\//i, async (route) =>
    route.abort("blockedbyclient"),
  );
  await page.setContent(stageDocument(html, stage, mode), {
    waitUntil: "load",
  });
  await page.evaluate(async () => {
    await document.fonts?.ready;
    await Promise.all(
      [...document.images].map((image) =>
        image.complete
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              image.addEventListener("load", () => resolve(), { once: true });
              image.addEventListener("error", () => resolve(), { once: true });
            }),
      ),
    );
  });
  const snapshot = await page.evaluate(collectLayoutSnapshot, viewport);
  const detection = detectLayoutIssues(snapshot, mode);
  const truncated = snapshot.document_scroll_height > MAX_FULL_PAGE_HEIGHT;
  const screenshotPath = path.join(outputDirectory, screenshot);
  const bytes = await page.screenshot({
    path: screenshotPath,
    type: "png",
    fullPage: !truncated,
    animations: "disabled",
    caret: "hide",
    timeout: 30_000,
  });
  const persisted = await readFile(screenshotPath);
  if (sha256Bytes(bytes) !== sha256Bytes(persisted))
    throw new Error(`Screenshot write verification failed: ${screenshot}`);
  return {
    stage,
    viewport,
    mode,
    screenshot,
    screenshot_sha256: sha256Bytes(persisted),
    screenshot_truncated: truncated,
    console_errors: [...new Set(consoleErrors)].sort(),
    page_errors: [...new Set(pageErrors)].sort(),
    generated_at: generatedAt,
    source_hash: sourceHash,
    rendered_html_hash: renderedHtmlHash,
    ...detection,
  };
}

async function atomicWriteReport(
  outputDirectory: string,
  report: PreviewReport,
): Promise<void> {
  const destination = path.join(outputDirectory, "preview-report.json");
  const temporary = path.join(
    outputDirectory,
    `.preview-report.${process.pid}.tmp`,
  );
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  try {
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

/**
 * Generates local, deterministic evidence for source/safe/WeChat preview stages.
 * Browser absence is a hard error and never produces a synthetic report.
 */
export async function generateArticlePreviews(
  input: GeneratePreviewInput,
): Promise<PreviewReport> {
  validateInput(input);
  const chromium = await loadProjectPlaywright();
  const executablePath = await resolveChromiumExecutable(
    chromium,
    input.chromiumExecutablePath,
  );
  const viewports = [...(input.viewports ?? DEFAULT_PREVIEW_VIEWPORTS)];
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const sourceHash = input.sourceHash.toLocaleLowerCase();
  const renderedHtmlHash = input.renderedHtmlHash.toLocaleLowerCase();
  const stageHashes = {
    raw: sha256(input.stages.raw),
    safe: sha256(input.stages.safe),
    wechat: sha256(input.stages.wechat),
  };
  const staticInspection = inspectHtmlStages({
    file: `${input.articleId}/build/article.raw.html`,
    rawHtml: input.stages.raw,
    safeHtml: input.stages.safe,
    wechatHtml: input.stages.wechat,
  });
  const prepared = await preparePreviewStages(input.stages, input.baseUrl);
  const darkPrepared = input.darkStages
    ? await preparePreviewStages(input.darkStages, input.baseUrl)
    : prepared;
  const darkStageHashes = input.darkStages
    ? {
        raw: sha256(input.darkStages.raw),
        safe: sha256(input.darkStages.safe),
        wechat: sha256(input.darkStages.wechat),
      }
    : undefined;
  const stages: Array<[PreviewStage, "raw" | "safe" | "wechat"]> = [
    ["source", "raw"],
    ...(input.includeSafeStage
      ? ([["safe", "safe"]] as Array<[PreviewStage, "safe"]>)
      : []),
    ["wechat", "wechat"],
  ];

  await mkdir(input.outputDirectory, { recursive: true });
  const browser = await chromium.launch({ executablePath, headless: true });
  const previews: PreviewResult[] = [];
  try {
    for (const [stage, key] of stages) {
      for (const mode of ["light", "dark"] as const) {
        const html = (mode === "dark" ? darkPrepared : prepared).stages[key];
        for (const viewport of viewports) {
          const context = await browser.newContext({
            viewport: { width: viewport.width, height: viewport.height },
            deviceScaleFactor: 1,
            colorScheme: mode,
            javaScriptEnabled: false,
            reducedMotion: "reduce",
          });
          try {
            const page = await context.newPage();
            previews.push(
              await renderOne(
                page,
                html,
                stage,
                mode,
                viewport,
                input.outputDirectory,
                screenshotName(stage, mode, viewport),
                generatedAt,
                sourceHash,
                renderedHtmlHash,
              ),
            );
            await page.close();
          } finally {
            await context.close();
          }
        }
      }
    }
  } finally {
    await browser.close();
  }

  const report = buildPreviewReport({
    articleId: input.articleId,
    sourceHash,
    renderedHtmlHash,
    stageHashes,
    darkStageHashes,
    generatedAt,
    viewports,
    staticDiagnostics: staticInspection.diagnostics,
    localAssets: [
      ...new Map(
        [...prepared.assets, ...darkPrepared.assets].map((asset) => [
          asset.sha256,
          asset,
        ]),
      ).values(),
    ],
    localAssetIssues: [
      ...new Map(
        [...prepared.issues, ...darkPrepared.issues].map((issue) => [
          `${issue.original_reference}\0${issue.code}`,
          issue,
        ]),
      ).values(),
    ],
    previews,
  });
  await atomicWriteReport(input.outputDirectory, report);
  return report;
}
