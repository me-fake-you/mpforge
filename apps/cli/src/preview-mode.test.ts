import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import {
  initializeWorkspace,
  createArticle,
  previewArticle,
  buildArticleArtifacts,
} from "./cli.js";
import { sha256 } from "@mpforge/renderer";
import { resolvePreviewBrowser } from "./preview.js";

const chromium = resolvePreviewBrowser();

it.runIf(Boolean(chromium && existsSync(chromium)))(
  "CLI preview uses actual light and dark renderer stages in its bound review evidence",
  async () => {
    const tempRoot = path.resolve("../../tmp/cli-preview-mode-tests");
    await mkdir(tempRoot, { recursive: true });
    const root = await mkdtemp(path.join(tempRoot, "workspace-"));
    try {
      await initializeWorkspace(root);
      await createArticle("mode-check", root);
      const build = await buildArticleArtifacts("mode-check", root);
      const report = await previewArticle("mode-check", root);
      expect(report.stage_hashes.wechat).toBe(
        sha256(build.light.wechatDocumentHtml),
      );
      expect(report.dark_stage_hashes?.wechat).toBe(
        sha256(build.dark.wechatDocumentHtml),
      );
      expect(report.dark_stage_hashes?.wechat).not.toBe(
        report.stage_hashes.wechat,
      );
      const dark = report.previews.filter(
        (entry) => entry.mode === "dark" && entry.stage !== "source",
      );
      expect(dark).toHaveLength(4);
      expect(dark.every((entry) => entry.contrast_warnings.length === 0)).toBe(
        true,
      );
      expect(report.page_errors).toEqual([]);
      expect(report.local_asset_issues).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  60_000,
);
