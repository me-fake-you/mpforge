// 编辑器公式高亮与 core 渲染的跨实现契约
//
// 公式是 WeMD 自己扩展的语法，编辑器（lezer）和渲染（markdown-it）是两套独立实现，
// 任何一侧单独改分隔符规则都会出现"编辑器高亮了但渲染不认"或反过来的不一致。
// 这里用同一组 fixture 同时喂给两套解析器，断言它们识别出的公式序列完全相同。
import { describe, expect, it } from "vitest";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { createMarkdownParser } from "@wemd/core";
import { mathExtension } from "../../components/Editor/markdownMath";
import { underlineExtension } from "../../components/Editor/markdownUnderline";

type MathSpan = { type: "inline" | "block"; latex: string };

/** 两侧对公式体的空白处理不同（core 会带上换行），比较前统一裁掉 */
const normalize = (spans: MathSpan[]) =>
  spans.map(({ type, latex }) => ({ type, latex: latex.trim() }));

/** 编辑器侧：从语法树取公式节点，用 MathMark 的位置切出公式体 */
const editorSpans = (doc: string): MathSpan[] => {
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
  const spans: MathSpan[] = [];

  tree.iterate({
    enter: (node) => {
      if (node.name !== "MathInline" && node.name !== "MathBlock") return;
      const marks: { from: number; to: number }[] = [];
      node.node.cursor().iterate((child) => {
        if (child.name === "MathMark") {
          marks.push({ from: child.from, to: child.to });
        }
      });
      // 未闭合的块级公式只有开定界符，公式体一直到节点末尾
      const from = marks[0].to;
      const to = marks.length > 1 ? marks[marks.length - 1].from : node.to;
      spans.push({
        type: node.name === "MathInline" ? "inline" : "block",
        latex: state.doc.sliceString(from, to),
      });
    },
  });

  return normalize(spans);
};

/** core 侧：直接读 markdown-it 的 math token */
const coreSpans = (doc: string): MathSpan[] => {
  const parser = createMarkdownParser({ mathRenderer: "katex" });
  const spans: MathSpan[] = [];

  const walk = (tokens: ReturnType<typeof parser.parse>) => {
    for (const token of tokens) {
      if (token.type === "math_inline" || token.type === "math_block") {
        spans.push({
          type: token.type === "math_inline" ? "inline" : "block",
          latex: token.content,
        });
      }
      if (token.children) walk(token.children);
    }
  };
  walk(parser.parse(doc, {}));

  return normalize(spans);
};

const cases: { name: string; doc: string; expected: MathSpan[] }[] = [
  {
    name: "行内公式",
    doc: "质能方程 $E = mc^2$ 结束",
    expected: [{ type: "inline", latex: "E = mc^2" }],
  },
  {
    name: "一行多个行内公式",
    doc: "$a$ 与 $b$",
    expected: [
      { type: "inline", latex: "a" },
      { type: "inline", latex: "b" },
    ],
  },
  { name: "开定界符后跟空白", doc: "$ E = mc^2$", expected: [] },
  { name: "闭定界符前是空白", doc: "$E = mc^2 $", expected: [] },
  {
    name: "货币写法",
    doc: "套餐 $5 和 $10 两档，从 $99 涨到 $199",
    expected: [],
  },
  { name: "空内容 $$", doc: "空的 $$ 结束", expected: [] },
  { name: "转义的美元符", doc: "价格 \\$5 到 \\$9", expected: [] },
  {
    name: "公式内部的转义美元",
    doc: "$a \\$ b$",
    expected: [{ type: "inline", latex: "a \\$ b" }],
  },
  { name: "行内公式未闭合", doc: "只有一个 $E = mc^2 结束", expected: [] },
  {
    name: "多行块级公式",
    doc: "正文\n\n$$\n\\int_0^1 x dx\n$$\n\n尾部",
    expected: [{ type: "block", latex: "\\int_0^1 x dx" }],
  },
  {
    name: "单行块级公式",
    doc: "$$ x = 1 $$",
    expected: [{ type: "block", latex: "x = 1" }],
  },
  // 先敲出一对 `$$$$` 再回到中间填公式是常见写法，此时是一个空公式块，不能吃掉后文
  {
    name: "空的单行块级公式",
    doc: "正文\n\n$$$$\n\n尾部",
    expected: [{ type: "block", latex: "" }],
  },
  {
    name: "段落中间的 $$ 不成块",
    doc: "段落中间 $$ x $$ 的写法",
    expected: [],
  },
  { name: "代码块里的 $$", doc: "```\n$$\nx\n$$\n```", expected: [] },
  {
    name: "块级公式未闭合时延伸到文末",
    doc: "$$\n\\int x dx\n\n后面是正文",
    expected: [{ type: "block", latex: "\\int x dx\n\n后面是正文" }],
  },
  {
    name: "列表中的未闭合块级公式不会越过列表边界",
    doc: "- $$\n  x\n\n列表外正文",
    expected: [{ type: "block", latex: "x" }],
  },
  {
    name: "引用中的未闭合块级公式不会越过引用边界",
    doc: "> $$\n\n引用外正文",
    expected: [{ type: "block", latex: "" }],
  },
  {
    name: "文末孤立的 $$",
    doc: "正文\n\n$$",
    expected: [{ type: "block", latex: "" }],
  },
];

describe("编辑器与 core 的公式识别契约", () => {
  it.each(cases)("$name", ({ doc, expected }) => {
    expect(coreSpans(doc)).toEqual(expected);
    expect(editorSpans(doc)).toEqual(expected);
  });
});
