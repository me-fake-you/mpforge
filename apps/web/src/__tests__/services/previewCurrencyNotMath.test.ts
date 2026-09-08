import { describe, expect, it } from "vitest";
import { createMarkdownParser } from "@wemd/core";

// 预览曾经在 markdown-it-math 之外又跑了一遍 DOM 级的公式渲染，
// 那一遍用的是无任何分隔符校验的正则 /\$\$([^$]+)\$\$|\$([^$]+)\$/g，
// 会把「套餐 $5 和 $10」里的 `$5 和 $` 当成公式渲染掉，货币符号凭空消失。
// 解析期渲染本身是正确的，第二遍纯属冗余，已删除。
const render = (source: string) =>
  createMarkdownParser({ mathRenderer: "katex" }).render(source);

describe("预览不把货币符号当成公式", () => {
  it.each([
    "套餐 $5 和 $10 两档，从 $99 涨到 $199。",
    "价格区间 $10 - $20",
    "他花了 $3 买了 $5 的东西",
  ])("保留 %s 里的所有美元符号", (source) => {
    const html = render(source);
    const expected = (source.match(/\$/g) ?? []).length;

    expect((html.match(/\$/g) ?? []).length).toBe(expected);
    expect(html).not.toContain("katex");
  });

  it("真正的公式仍然在解析期就渲染成 KaTeX", () => {
    const html = render("质能方程 $E = mc^2$ 结束");

    expect(html).toContain("katex");
    // 公式的原始 $ 定界符不应残留在输出里
    expect(html).not.toContain("$E = mc^2$");
  });

  it("块级公式同样在解析期渲染", () => {
    expect(render("$$\n\\frac{a}{b}\n$$")).toContain("katex");
  });

  it("货币与公式混排时各自归位", () => {
    const html = render("价格 $9 与公式 $x^2$ 同段");

    expect(html).toContain("katex");
    // 货币的那个 $ 必须留下
    expect(html).toContain("$9");
  });
});
