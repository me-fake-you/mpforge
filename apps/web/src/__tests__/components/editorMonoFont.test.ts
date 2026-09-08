/// <reference types="node" />

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const localFontsCss = readFileSync("src/styles/local-fonts.css", "utf8");
const tokensCss = readFileSync("src/index.css", "utf8");
const markdownTheme = readFileSync(
  "src/components/Editor/markdownTheme.ts",
  "utf8",
);

// 每个 @font-face 声明的 woff2 都必须真的存在，否则线上直接掉到系统兜底字体
const MAPLE_FACES = [
  { weight: "400", style: "normal", file: "maple-mono-latin-regular.woff2" },
  { weight: "400", style: "italic", file: "maple-mono-latin-italic.woff2" },
  { weight: "500", style: "normal", file: "maple-mono-latin-500.woff2" },
  { weight: "700", style: "normal", file: "maple-mono-latin-700.woff2" },
];

describe("编辑器等宽字体", () => {
  it.each(MAPLE_FACES)(
    "声明 Maple Mono $weight/$style 且字体文件已打包",
    ({ weight, style, file }) => {
      const face = localFontsCss
        .split("@font-face")
        .find(
          (block) =>
            block.includes('"Maple Mono"') &&
            block.includes(`font-weight: ${weight};`) &&
            block.includes(`font-style: ${style};`),
        );

      expect(face, `${weight}/${style} 缺少 @font-face`).toBeTruthy();
      expect(face).toContain(file);
      expect(face).toContain("font-display: swap");
      expect(existsSync(`public/fonts/maple-mono/${file}`)).toBe(true);
    },
  );

  it("随字体附带 OFL 许可证", () => {
    const license = readFileSync("public/fonts/maple-mono/LICENSE", "utf8");

    expect(license).toContain("SIL Open Font License");
    expect(license).toContain("Maple Mono");
  });

  it("等宽字体栈以 Maple Mono 打头，并保留系统与 CJK 兜底", () => {
    const stacks = [...tokensCss.matchAll(/--ui-font-mono:\s*([^;]+);/g)].map(
      (match) => match[1].replace(/\s+/g, " ").trim(),
    );

    // 亮色与暗色两个 token 块都要覆盖到
    expect(stacks).toHaveLength(2);
    for (const stack of stacks) {
      expect(stack.startsWith('"Maple Mono"')).toBe(true);
      // 字体加载失败时的系统兜底
      expect(stack).toContain("Menlo");
      expect(stack).toContain("Consolas");
      // Maple Mono 只有 latin 子集，中文必须显式兜底，
      // 否则 Windows 的通用 monospace 会落到 SimSun
      expect(stack).toContain("PingFang SC");
      expect(stack).toContain("Microsoft YaHei");
      expect(stack.endsWith("monospace")).toBe(true);
    }
  });

  it("高亮样式复用同一个字体栈，不另起一套", () => {
    expect(markdownTheme).toContain('const MONO_FAMILY = "var(--font-mono)"');
    expect(markdownTheme).not.toMatch(/SFMono-Regular|"SF Mono"/);
  });

  it.each([
    "src/components/Editor/MarkdownEditor.css",
    "src/components/Editor/SyntaxHelpPopover.css",
    "src/components/Sidebar/SidebarFooter.css",
    "src/components/Theme/ThemePanel.css",
  ])("%s 用到等宽字体的地方都关掉了连字", (path) => {
    const css = readFileSync(path, "utf8");
    // Maple Mono 默认会把 `<!--`、`!==`、`=>` 合成单字形，
    // 等宽场景（源码、语法示例、版本号）必须逐字符可辨
    const blocks = css
      .split("}")
      .filter((block) => block.includes("font-family: var(--font-mono)"));

    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      expect(block).toContain("font-variant-ligatures: none");
      expect(block).toMatch(/"calt" 0/);
      expect(block).toMatch(/"liga" 0/);
    }
  });
});

// 历史上 public/fonts/ 里躺过一份没人引用的 local-fonts.css，Inter 和 Noto Serif SC
// 的 @font-face 只写在那里，字体文件白白进产物近 3MB 却从未加载过。
describe("字体资源", () => {
  it("public/fonts 下的每个字族都被真源 @font-face 引用", () => {
    const declared = readFileSync("src/styles/local-fonts.css", "utf8");
    const families = readdirSync("public/fonts", { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    expect(families.length).toBeGreaterThan(0);
    for (const family of families) {
      expect(declared, `public/fonts/${family} 无人引用`).toContain(
        `/fonts/${family}/`,
      );
    }
  });

  it("真源声明的每个 woff2 都真实存在", () => {
    const declared = readFileSync("src/styles/local-fonts.css", "utf8");
    const urls = [...declared.matchAll(/url\("(\/fonts\/[^"]+)"\)/g)].map(
      (match) => match[1],
    );

    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(existsSync(`public${url}`), `${url} 不存在`).toBe(true);
    }
  });

  it("public/fonts 下不存在第二份字体声明文件", () => {
    expect(existsSync("public/fonts/local-fonts.css")).toBe(false);
  });
});
