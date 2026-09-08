import { describe, expect, it } from "vitest";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { mathExtension } from "../../components/Editor/markdownMath";
import { underlineExtension } from "../../components/Editor/markdownUnderline";

/** 返回文档里所有公式节点的原文，用于判断解析边界是否与 core 一致 */
const parseMath = (doc: string) => {
  const state = EditorState.create({
    doc,
    extensions: [
      markdown({
        base: markdownLanguage,
        extensions: [underlineExtension, mathExtension],
      }),
    ],
  });
  const tree = ensureSyntaxTree(state, state.doc.length, 10000)!;
  const found: { name: string; text: string }[] = [];
  tree.iterate({
    enter: (node) => {
      if (node.name === "MathInline" || node.name === "MathBlock") {
        found.push({
          name: node.name,
          text: state.doc.sliceString(node.from, node.to),
        });
      }
    },
  });
  return found;
};

const inlineTexts = (doc: string) =>
  parseMath(doc)
    .filter((item) => item.name === "MathInline")
    .map((item) => item.text);

describe("编辑器行内公式识别", () => {
  it("识别基本行内公式", () => {
    expect(inlineTexts("质能方程 $E = mc^2$ 结束")).toEqual(["$E = mc^2$"]);
  });

  it("一行里的多个公式各自独立", () => {
    expect(inlineTexts("$a$ 与 $b$")).toEqual(["$a$", "$b$"]);
  });

  // 与 core 的 isValidDelim 对齐：开定界符后不能是空白
  it("开定界符后跟空白时不解析", () => {
    expect(inlineTexts("$ E = mc^2$")).toEqual([]);
  });

  // 闭定界符前不能是空白
  it("闭定界符前是空白时不解析", () => {
    expect(inlineTexts("$E = mc^2 $")).toEqual([]);
  });

  // 这条是货币写法的保护：闭定界符后面跟数字则不成立
  it("货币写法不会被误判成公式", () => {
    expect(inlineTexts("套餐 $5 和 $10 两档")).toEqual([]);
    expect(inlineTexts("从 $99 涨到 $199")).toEqual([]);
  });

  it("空内容 $$ 不解析成行内公式", () => {
    expect(inlineTexts("空的 $$ 结束")).toEqual([]);
  });

  it("转义的 \\$ 不作为定界符", () => {
    expect(inlineTexts("价格 \\$5 到 \\$9")).toEqual([]);
  });

  it("公式内部的转义美元不提前闭合", () => {
    expect(inlineTexts("$a \\$ b$")).toEqual(["$a \\$ b$"]);
  });

  it("没有闭合定界符时不解析", () => {
    expect(inlineTexts("只有一个 $E = mc^2 结束")).toEqual([]);
  });
});

describe("编辑器块级公式识别", () => {
  const blockTexts = (doc: string) =>
    parseMath(doc)
      .filter((item) => item.name === "MathBlock")
      .map((item) => item.text);

  it("识别多行块级公式", () => {
    expect(blockTexts("正文\n\n$$\n\\int_0^1 x dx\n$$\n\n尾部")).toEqual([
      "$$\n\\int_0^1 x dx\n$$",
    ]);
  });

  it("识别单行块级公式", () => {
    expect(blockTexts("$$ x = 1 $$")).toEqual(["$$ x = 1 $$"]);
  });

  // core 的 math_block 找不到闭合定界符时会一直吃到文档末尾，编辑器同样如此
  it("没有闭合时公式块延伸到文末", () => {
    expect(blockTexts("$$\n\\int x dx\n\n后面是正文")).toEqual([
      "$$\n\\int x dx\n\n后面是正文",
    ]);
  });

  it("容器内未闭合的公式块不会吞掉容器外正文", () => {
    expect(blockTexts("- $$\n  x\n\n列表外正文")).toEqual(["$$\n  x\n"]);
    expect(blockTexts("> $$\n\n引用外正文")).toEqual(["$$"]);
  });

  // 回归：block parser 扫到文末后一旦返回 false，lezer 会认为这一行没被消费，
  // 但上下文已被推到末尾，整篇文档都建不出语法树
  it("未闭合公式块不破坏前文的语法树", () => {
    const doc = "## 标题\n\n**加粗**段落\n\n$$\nx";
    const state = EditorState.create({
      doc,
      extensions: [
        markdown({
          base: markdownLanguage,
          extensions: [underlineExtension, mathExtension],
        }),
      ],
    });
    const tree = ensureSyntaxTree(state, state.doc.length, 10000)!;
    const names: string[] = [];
    tree.iterate({ enter: (node) => void names.push(node.name) });

    expect(names).toContain("ATXHeading2");
    expect(names).toContain("StrongEmphasis");
    expect(names).toContain("MathBlock");
  });

  it("块级公式不吞掉后续正文", () => {
    const doc = "$$\na\n$$\n\n正常段落";
    expect(blockTexts(doc)).toEqual(["$$\na\n$$"]);
    // 后面的段落仍要被解析成 Paragraph
    const state = EditorState.create({
      doc,
      extensions: [
        markdown({
          base: markdownLanguage,
          extensions: [underlineExtension, mathExtension],
        }),
      ],
    });
    const tree = ensureSyntaxTree(state, state.doc.length, 10000)!;
    let hasParagraph = false;
    tree.iterate({
      enter: (node) => {
        if (
          node.name === "Paragraph" &&
          state.doc.sliceString(node.from, node.to).includes("正常段落")
        ) {
          hasParagraph = true;
        }
      },
    });
    expect(hasParagraph).toBe(true);
  });

  it("代码块里的 $$ 不被当成公式", () => {
    expect(blockTexts("```\n$$\nx\n$$\n```")).toEqual([]);
  });
});
