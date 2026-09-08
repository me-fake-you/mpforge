// 编辑器 Markdown 语法高亮
//
// 只描述 Markdown 结构本身的 token（标题、强调、链接、引用、列表、标记符号等）。
// 围栏代码块内部的语言 token（keyword/string/number…）不在这里定义，交给基础主题
// githubLight / githubDark 的 style 兜底：syntaxHighlighting 的 facet 只取第一个命中的
// highlighter，本文件排在基础主题之前，因此 Markdown 结构完全由这里控制，语言 token 自然回落。
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { githubDarkInit, githubLightInit } from "@uiw/codemirror-theme-github";
import { mathMarkTag, mathTag } from "./markdownMath";
import { underlineMarkTag, underlineTag } from "./markdownUnderline";

// 等宽字体栈只有 --font-mono 一个真源，这里不再另起一套
const MONO_FAMILY = "var(--font-mono)";

// 标题字号不在这里定义。字号写在 MarkdownEditor.css 的 .cm-md-heading-N 上，
// 因为 `#` 标记要用 calc() 反向抵消标题缩放，两者必须共享同一个 --heading-scale。

interface MarkdownPalette {
  heading: [string, string, string, string, string, string];
  strong: string;
  emphasis: string;
  muted: string;
  /** `#`、`**`、`>`、`-`、`` ` `` 等标记符号 */
  mark: string;
  link: string;
  url: string;
  label: string;
  quote: string;
  content: string;
  accentSoft: string;
  string: string;
  math: string;
}

// 正文刻意不压到最黑，给加粗留出可感知的色阶余量；由深到浅的层级是
// 加粗 > 标题 > 正文 > 引用 > 注释 > 标记符号。
const lightPalette: MarkdownPalette = {
  heading: ["#0b1310", "#101a16", "#16221d", "#1d2b25", "#24342d", "#2b3c34"],
  strong: "#05090a",
  // 中文没有真斜体（PingFang 只能靠浏览器合成倾斜），单靠字形撑不起强调，
  // 必须补一个颜色信号。冷色是调色板里唯一没被占用的色相
  emphasis: "#3c5a72",
  muted: "#67736c",
  mark: "#7e8a83",
  link: "#047857",
  url: "#68786f",
  label: "#0f766e",
  quote: "#46564d",
  content: "#37403c",
  accentSoft: "#047857",
  string: "#8a6236",
  math: "#6b3fa0",
};

// 同浅色：正文不顶到最亮，把最亮留给加粗
const darkPalette: MarkdownPalette = {
  heading: ["#ffffff", "#f4f8f5", "#eaf0ec", "#e0e7e3", "#d8e0dc", "#d0d9d5"],
  strong: "#ffffff",
  emphasis: "#8fb4d0",
  muted: "#84938b",
  mark: "#84938b",
  link: "#35c391",
  url: "#8fa198",
  label: "#4fd1a5",
  quote: "#a3b3aa",
  content: "#c6ccc9",
  accentSoft: "#35c391",
  string: "#d0a877",
  math: "#c3a6f0",
};

const createMarkdownHighlightStyle = (palette: MarkdownPalette) =>
  HighlightStyle.define([
    // 规则顺序即优先级。lezer-markdown 用 "Blockquote/..."、"ATXHeading1/..." 这类通配把父
    // tag 下发给所有后代，后代自身的 tag 规则和继承来的规则会同时挂在一个元素上，最终由
    // StyleModule 的定义顺序（同特异度下的 CSS 层叠）决定谁生效。因此必须按"越通用越靠前"排：
    // 正文兜底 → 结构 → 标记符号。

    // 正文兜底：Paragraph、TableCell
    { tag: t.content, color: palette.content },

    // 标题层次
    ...[
      t.heading1,
      t.heading2,
      t.heading3,
      t.heading4,
      t.heading5,
      t.heading6,
    ].map((tag, index) => ({
      tag,
      fontWeight: index < 2 ? "700" : "600",
      color: palette.heading[index],
    })),
    // 表格表头沿用标题色，但不放大字号
    { tag: t.heading, fontWeight: "600", color: palette.heading[1] },

    // 块级结构
    { tag: t.quote, color: palette.quote, fontStyle: "italic" },
    { tag: t.list, color: palette.content },
    { tag: t.comment, color: palette.muted, fontStyle: "italic" },

    // 强调
    { tag: t.strong, fontWeight: "700", color: palette.strong },
    { tag: t.emphasis, fontStyle: "italic", color: palette.emphasis },
    {
      tag: t.strikethrough,
      textDecoration: "line-through",
      color: palette.muted,
    },
    { tag: underlineTag, textDecoration: "underline" },

    // 链接与图片
    { tag: t.link, color: palette.link, fontWeight: "500" },
    { tag: t.url, color: palette.url },
    { tag: t.labelName, color: palette.label },
    { tag: t.string, color: palette.string },
    { tag: [t.escape, t.character], color: palette.string },
    // 公式是 WeMD 自有能力，lezer 不认识，语法由 markdownMath.ts 补上
    { tag: mathTag, color: palette.math },
    // 任务列表勾选框
    { tag: t.atom, color: palette.accentSoft },

    // 行内代码与代码块正文共用 t.monospace，这里只统一字体；
    // 行内代码的底色与前景交给 editorMarkdownDecorations 的节点级装饰，
    // 否则代码块正文会被一起染成行内代码
    { tag: t.monospace, fontFamily: MONO_FAMILY },

    // 标记符号优先级最高，压过从标题/引用/列表继承下来的颜色
    {
      tag: [
        t.processingInstruction,
        t.contentSeparator,
        underlineMarkTag,
        mathMarkTag,
      ],
      color: palette.mark,
      fontWeight: "400",
    },
  ]);

// 表面色、光标与选区全部走设计 token，避免第三方主题的固定配色与应用外壳脱节
const baseSettings = {
  background: "transparent",
  foreground: "var(--text-primary)",
  caret: "var(--accent-primary)",
  selection: "color-mix(in srgb, var(--accent-primary) 20%, transparent)",
  selectionMatch: "color-mix(in srgb, var(--accent-primary) 14%, transparent)",
  lineHighlight: "transparent",
  gutterBackground: "transparent",
  gutterForeground: "var(--text-tertiary)",
  gutterBorder: "transparent",
};

/** 基础主题只提供编辑器外壳与代码语言 token 配色 */
export const editorBaseThemeLight = githubLightInit({ settings: baseSettings });

export const editorBaseThemeDark = githubDarkInit({ settings: baseSettings });

export const markdownHighlightStyleLight =
  createMarkdownHighlightStyle(lightPalette);

export const markdownHighlightStyleDark =
  createMarkdownHighlightStyle(darkPalette);

export const wechatMarkdownHighlighting = syntaxHighlighting(
  markdownHighlightStyleLight,
);

export const wechatMarkdownHighlightingDark = syntaxHighlighting(
  markdownHighlightStyleDark,
);
