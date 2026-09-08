import { describe, expect, it } from "vitest";

import { locateQuote, locateQuoteMatch } from "../../services/ai/aiLocate";

const doc = `# 公众号排版指南

很多人写完文章直接粘贴到公众号，结果排版一塌糊涂，读者划两下就走了。

真正的问题不在工具，而在于**没有把手机屏幕当成阅读场景**来考虑。`;

const slice = (range: { from: number; to: number } | null) =>
  range ? doc.slice(range.from, range.to) : null;

describe("行内标记", () => {
  const bold =
    "**超智算科技**是国际领先的全栈式算力运营商，已完成五城节点布局。";

  it("正文加粗、引用不带标记时仍能定位", () => {
    const range = locateQuote(bold, "超智算科技是国际领先的全栈式算力运营商");
    expect(range).not.toBeNull();
  });

  it("区间要把整对加粗标记吃进去，否则替换后标记不闭合", () => {
    const range = locateQuote(bold, "超智算科技是国际领先的全栈式算力运营商")!;
    expect(bold.slice(range.from, range.to)).toBe(
      "**超智算科技**是国际领先的全栈式算力运营商",
    );
    const next = bold.slice(0, range.from) + "新句子" + bold.slice(range.to);
    expect(next).toBe("新句子，已完成五城节点布局。");
  });

  it("高亮、行内代码、删除线同样不阻断匹配", () => {
    const doc = "先看 `pnpm build` 再看 ==构建产物== 与 ~~旧流程~~ 的差别。";
    expect(locateQuote(doc, "先看 pnpm build 再看 构建产物")).not.toBeNull();
  });

  it("标题标记不会被吃进区间，否则采纳后标题降级成正文", () => {
    const doc = "## 1. 基础语法\n\n正文内容在这里。";
    const range = locateQuote(doc, "1. 基础语法")!;
    expect(doc.slice(range.from, range.to)).toBe("1. 基础语法");
  });

  it("跨链接的引用宁可定位失败，也不算出会破坏链接的区间", () => {
    const doc = "这是一个 [链接](https://example.com/a) 后面还有文字。";
    expect(locateQuote(doc, "这是一个 链接 后面还有文字")).toBeNull();
  });
});

describe("引用定位", () => {
  it("重复引用返回歧义，不自动猜测第一处", () => {
    const repeated = "同一段正文出现两次。\n\n同一段正文出现两次。";
    expect(locateQuoteMatch(repeated, "同一段正文出现两次").status).toBe(
      "ambiguous",
    );
    expect(locateQuote(repeated, "同一段正文出现两次")).toBeNull();
  });

  it("原样引用直接命中", () => {
    const range = locateQuote(doc, "结果排版一塌糊涂");
    expect(slice(range)).toBe("结果排版一塌糊涂");
  });

  it("模型把全角标点换成半角也能定位", () => {
    const range = locateQuote(
      doc,
      "很多人写完文章直接粘贴到公众号,结果排版一塌糊涂",
    );
    expect(slice(range)).toBe(
      "很多人写完文章直接粘贴到公众号，结果排版一塌糊涂",
    );
  });

  it("引用里多出或少掉空白不影响定位", () => {
    const range = locateQuote(doc, "很多人写完文章 直接粘贴到 公众号");
    expect(slice(range)).toBe("很多人写完文章直接粘贴到公众号");
  });

  it("截断留下的省略号不参与匹配", () => {
    const range = locateQuote(doc, "很多人写完文章直接粘贴到公众号……");
    expect(slice(range)).toBe("很多人写完文章直接粘贴到公众号");
  });

  it("整段对不上时退到前缀匹配", () => {
    const range = locateQuote(
      doc,
      "真正的问题不在工具，而在于没有把手机当成阅读场景",
    );
    expect(slice(range)).toContain("真正的问题不在工具");
  });

  it("正文里根本没有的句子返回 null，不能瞎猜一个位置", () => {
    expect(locateQuote(doc, "这句话是模型编的，正文里没有")).toBeNull();
  });

  it("片段太短不定位，避免撞上无关位置", () => {
    expect(locateQuote(doc, "文章")).toBeNull();
    expect(locateQuote(doc, "")).toBeNull();
  });
});
