import { describe, expect, it } from "vitest";

import {
  MAX_SELECTION_CHARS,
  checkSelection,
  extractContext,
  isInsideCodeFence,
} from "../../services/ai/aiSelection";

const doc = [
  "# 标题", // 0
  "", // 1
  "第一段第一行", // 2
  "第一段第二行", // 3
  "", // 4
  "第二段内容", // 5
  "", // 6
  "```js", // 7
  "const a = 1;", // 8
  "```", // 9
  "", // 10
  "结尾段落", // 11
].join("\n");

function offsetOfLine(text: string, lineIndex: number): number {
  return (
    text.split("\n").slice(0, lineIndex).join("\n").length +
    (lineIndex > 0 ? 1 : 0)
  );
}

describe("代码块判定", () => {
  it("围栏内为真，围栏外为假", () => {
    expect(isInsideCodeFence(doc, offsetOfLine(doc, 8))).toBe(true);
    expect(isInsideCodeFence(doc, offsetOfLine(doc, 5))).toBe(false);
  });

  it("支持波浪线围栏", () => {
    const tilde = ["正文", "", "~~~", "code", "~~~", "", "结尾"].join("\n");
    expect(isInsideCodeFence(tilde, offsetOfLine(tilde, 3))).toBe(true);
    expect(isInsideCodeFence(tilde, offsetOfLine(tilde, 6))).toBe(false);
  });
});

describe("上下文提取", () => {
  it("取选区前后的文本，并去除首尾空白", () => {
    const from = offsetOfLine(doc, 5);
    const to = from + "第二段内容".length;
    const context = extractContext(doc, from, to);

    expect(context.before).toContain("第一段第二行");
    expect(context.after).toContain("```js");
  });

  it("超出上限时从行边界起算，不留半句", () => {
    const long = `${"甲".repeat(300)}\n${"乙".repeat(300)}\n目标片段`;
    const from = long.indexOf("目标片段");
    const context = extractContext(long, from, from + 4, 100);

    expect(context.before).toBe("");
  });

  it("文档开头与结尾不会因截断丢内容", () => {
    const short = "上一段\n\n目标\n\n下一段";
    const from = short.indexOf("目标");
    const context = extractContext(short, from, from + 2);

    expect(context.before).toBe("上一段");
    expect(context.after).toBe("下一段");
  });
});

describe("选区校验", () => {
  const plain = "这是一段足够长的正文内容，用于测试选区校验逻辑。";

  it("过短的选区不通过", () => {
    expect(checkSelection(plain, 0, 2)).toEqual({
      ok: false,
      reason: "too-short",
    });
  });

  it("过长的选区不通过", () => {
    const huge = "字".repeat(MAX_SELECTION_CHARS + 10);
    expect(checkSelection(huge, 0, huge.length)).toEqual({
      ok: false,
      reason: "too-long",
    });
  });

  it("代码块内的选区不通过", () => {
    expect(
      checkSelection(doc, offsetOfLine(doc, 8), offsetOfLine(doc, 8) + 8),
    ).toEqual({ ok: false, reason: "inside-code-fence" });
  });

  it("正常选区通过", () => {
    expect(checkSelection(plain, 0, 10)).toEqual({ ok: true });
  });
});
