import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { sha256 } from "@mpforge/renderer";
import { PreviewBrowserUnavailableError } from "./browser-loader.js";
import { generateArticlePreviews } from "./preview.js";
import { deterministicReportProjection } from "./report.js";

const hash = (character: string): string => character.repeat(64);
const projectChromium =
  process.env.MPFORGE_CHROMIUM_EXECUTABLE ??
  path.resolve(
    process.cwd(),
    ".cache/playwright/chromium-1234/chrome-win64/chrome.exe",
  );
const generatedDirectories: string[] = [];
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

async function temporaryDirectory(): Promise<string> {
  const root = path.resolve(process.cwd(), ".tmp-tests");
  const directory = await mkdtemp(`${root}-`);
  generatedDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    generatedDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("generateArticlePreviews", () => {
  it.runIf(existsSync(projectChromium))(
    "renders and binds the actual dark HTML instead of light text on a dark canvas",
    async () => {
      const outputDirectory = await temporaryDirectory();
      const light = '<p style="color:#111111">Readable article</p>';
      const dark = '<p style="color:#eeeeee">Readable article</p>';
      const report = await generateArticlePreviews({
        articleId: "mode-specific-rendering",
        stages: { raw: light, safe: light, wechat: light },
        darkStages: { raw: dark, safe: dark, wechat: dark },
        sourceHash: hash("a"),
        renderedHtmlHash: hash("b"),
        outputDirectory,
        chromiumExecutablePath: projectChromium,
        includeSafeStage: true,
      });
      expect(report.previews).toHaveLength(12);
      expect(
        report.previews.every((entry) => entry.contrast_warnings.length === 0),
      ).toBe(true);
      expect(
        report.previews.every(
          (entry) =>
            entry.page_errors.length === 0 && entry.console_errors.length === 0,
        ),
      ).toBe(true);
      expect(report.stage_hashes.wechat).toBe(sha256(light));
      expect(report.dark_stage_hashes?.wechat).toBe(sha256(dark));
      expect(report.report_binding_hash).toBe(
        sha256(JSON.stringify(deterministicReportProjection(report))),
      );
      const changed = {
        ...report,
        dark_stage_hashes: { ...report.dark_stage_hashes!, wechat: hash("f") },
      };
      expect(
        sha256(JSON.stringify(deterministicReportProjection(changed))),
      ).not.toBe(report.report_binding_hash);
    },
    60_000,
  );

  it("fails explicitly and writes no fake report when Chromium is unavailable", async () => {
    const outputDirectory = await temporaryDirectory();
    await expect(
      generateArticlePreviews({
        articleId: "no-browser",
        stages: {
          raw: "<p>raw</p>",
          safe: "<p>safe</p>",
          wechat: "<p>wechat</p>",
        },
        sourceHash: hash("a"),
        renderedHtmlHash: hash("b"),
        outputDirectory,
        chromiumExecutablePath: path.join(
          outputDirectory,
          "missing-chromium.exe",
        ),
      }),
    ).rejects.toBeInstanceOf(PreviewBrowserUnavailableError);
    expect(existsSync(path.join(outputDirectory, "preview-report.json"))).toBe(
      false,
    );
    expect(
      existsSync(path.join(outputDirectory, "preview-source-light.png")),
    ).toBe(false);
  });

  it.runIf(existsSync(projectChromium))(
    "generates the stable four preview names at both mobile widths and records DOM findings",
    async () => {
      const outputDirectory = await temporaryDirectory();
      const raw = `<script>globalThis.__unsafeExecuted=true</script><h1>Preview</h1><table style="width:900px"><tr><td>wide</td></tr></table><img src="missing.png" alt="missing">`;
      const report = await generateArticlePreviews({
        articleId: "preview-fixture",
        stages: {
          raw,
          safe: `<h1>Preview</h1><table style="width:900px"><tr><td>wide</td></tr></table><img src="missing.png" alt="missing">`,
          wechat: `<h1>Preview</h1><div style="width:900px">wide WeChat simulation</div><img src="missing.png" alt="missing">`,
        },
        sourceHash: hash("a"),
        renderedHtmlHash: hash("b"),
        outputDirectory,
        chromiumExecutablePath: projectChromium,
        generatedAt: "2026-09-01T00:00:00.000Z",
      });
      for (const file of [
        "preview-source-light.png",
        "preview-source-dark.png",
        "preview-wechat-light.png",
        "preview-wechat-dark.png",
        "preview-source-light-402.png",
        "preview-source-dark-402.png",
        "preview-wechat-light-402.png",
        "preview-wechat-dark-402.png",
      ]) {
        expect(existsSync(path.join(outputDirectory, file)), file).toBe(true);
      }
      expect(report.previews).toHaveLength(8);
      expect(report.horizontal_overflow).toBe(true);
      expect(report.missing_images.length).toBeGreaterThan(0);
      expect(
        report.static_diagnostics.some(
          (diagnostic) => diagnostic.rule_id === "html.raw.tag.script",
        ),
      ).toBe(true);
      expect(report.page_errors).toEqual([]);
      expect(report.report_binding_hash).toMatch(/^[a-f\d]{64}$/);
      const persisted = JSON.parse(
        await readFile(
          path.join(outputDirectory, "preview-report.json"),
          "utf8",
        ),
      ) as typeof report;
      expect(persisted.report_binding_hash).toBe(report.report_binding_hash);
      expect(
        persisted.previews.every((entry) => entry.source_hash === hash("a")),
      ).toBe(true);
    },
    60_000,
  );

  it.runIf(existsSync(projectChromium))(
    "inlines an existing article-local image without missing-image or file-resource errors",
    async () => {
      const articleDirectory = await temporaryDirectory();
      const outputDirectory = path.join(articleDirectory, "build");
      await mkdir(path.join(articleDirectory, "assets"), { recursive: true });
      await writeFile(
        path.join(articleDirectory, "assets", "pixel.png"),
        PNG_1X1,
      );
      const html =
        '<h1>Local image</h1><img src="assets/pixel.png" alt="pixel">';
      const report = await generateArticlePreviews({
        articleId: "local-image-fixture",
        stages: { raw: html, safe: html, wechat: html },
        sourceHash: hash("c"),
        renderedHtmlHash: hash("d"),
        outputDirectory,
        baseUrl: pathToFileURL(`${articleDirectory}${path.sep}`).href,
        chromiumExecutablePath: projectChromium,
        generatedAt: "2026-09-01T00:00:00.000Z",
      });
      expect(report.local_assets).toEqual([
        expect.objectContaining({
          original_reference: "assets/pixel.png",
          local_path: "assets/pixel.png",
          mime_type: "image/png",
        }),
      ]);
      expect(report.local_asset_issues).toEqual([]);
      expect(report.missing_images).toEqual([]);
      expect(
        report.previews.every((preview) => preview.missing_images.length === 0),
      ).toBe(true);
      expect(report.console_errors.join("\n")).not.toContain(
        "Not allowed to load local resource",
      );
      expect(report.page_errors).toEqual([]);
    },
    60_000,
  );
});
