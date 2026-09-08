/// <reference types="node" />

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const previewCss = readFileSync(
  "src/components/Preview/MarkdownPreview.css",
  "utf8",
);

describe("MarkdownPreview responsive layout", () => {
  it("桌面预览保持固定的公众号画布宽度", () => {
    expect(previewCss).toMatch(
      /\.preview-content\s*\{[\s\S]*?box-sizing:\s*border-box;[\s\S]*?width:\s*var\(--mpforge-preview-width,\s*402px\);/,
    );
  });

  it("预留稳定的竖向滚动条槽，避免画布在输入时左右抖动", () => {
    expect(previewCss).toMatch(
      /\.preview-container\s*\{[\s\S]*?scrollbar-gutter:\s*stable\s+both-edges;/,
    );
  });

  it("桌面预览在 402px 画布中保留足够的正文宽度", () => {
    expect(previewCss).toMatch(
      /\.preview-content\s*\{[\s\S]*?padding:\s*44px\s+24px\s+80px;/,
    );
    expect(402 - 24 * 2).toBeGreaterThanOrEqual(350);
  });

  it("仅移动布局使用容器宽度", () => {
    expect(previewCss).toMatch(
      /@media\s*\(max-width:\s*768px\)[\s\S]*?\.app\[data-layout-mode=["']mobile["']\]\s+\.preview-content\s*\{[\s\S]*?width:\s*100%;/,
    );
  });
});
