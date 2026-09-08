// Markdown 块级视觉装饰
//
// CodeMirror 6 的 HighlightStyle 只能作用在 token 上，代码块底色、引用左边条这类"整行"效果
// 必须通过 Decoration.line 实现；行内代码与代码块正文共用 t.monospace，也只能在节点层面区分。
import { syntaxTree } from "@codemirror/language";
import type { Line, Range, Text } from "@codemirror/state";
import {
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from "@codemirror/view";

const CODE_BLOCK_NODES = new Set(["FencedCode", "CodeBlock"]);
const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const;
const HEADING_NODE = /^(?:ATX|Setext)Heading([1-6])$/;

/** GitHub 风格提示块，与 packages/core 的 markdown-it-github-alert 保持一致 */
const ALERT_TYPES = ["note", "tip", "important", "warning", "caution"] as const;
const QUOTE_MARKER = /^\s*>+\s*/;
const ALERT_MARKER = new RegExp(`^\\[!(${ALERT_TYPES.join("|")})\\]`, "i");

const codeLine = Decoration.line({ class: "cm-md-code-line" });
// 同一行上的多个 line decoration 会由 CodeMirror 合并 class，
// 首尾标记因此可以独立于块类型复用
const blockFirst = Decoration.line({ class: "cm-md-block-first" });
const blockLast = Decoration.line({ class: "cm-md-block-last" });
const quoteLine = Decoration.line({ class: "cm-md-quote-line" });
const inlineCode = Decoration.mark({ class: "cm-md-inline-code" });
const alertMarker = Decoration.mark({ class: "cm-md-alert-marker" });
// 列表标记是结构信号，有序列表的数字更是携带顺序信息的，
// 不该和 `**`、`` ` `` 这类纯格式噪音一样淡化到同一档
const listMarker = Decoration.mark({ class: "cm-md-list-marker" });
// 键类型显式写成 number：级别是从节点名正则里解析出来的，拿不到字面量类型
const headingLines = new Map<number, Decoration>(
  HEADING_LEVELS.map((level) => [
    level,
    Decoration.line({ class: `cm-md-heading-line cm-md-heading-${level}` }),
  ]),
);
const alertLines = new Map(
  ALERT_TYPES.map((type) => [
    type,
    Decoration.line({ class: `cm-md-alert-line cm-md-alert-${type}` }),
  ]),
);

// 只遍历"节点与可见范围的交集"：超长代码块每次视口更新都全量走行会明显掉帧，
// 但首尾圆角仍要按节点真实边界判断，所以两组边界分开传
const eachLineInRange = (
  doc: Text,
  node: { from: number; to: number },
  visible: { from: number; to: number },
  visit: (line: Line, isFirst: boolean, isLast: boolean) => void,
) => {
  const stop = Math.min(node.to, visible.to);
  let pos = Math.max(node.from, visible.from);
  while (pos <= stop) {
    const line = doc.lineAt(pos);
    visit(line, line.from <= node.from, line.to >= node.to);
    if (line.to >= stop) break;
    pos = line.to + 1;
  }
};

/** 提示块的类型写在引用首行的 `> [!TIP]` 里，识别后整块换一套配色 */
const matchAlert = (doc: Text, node: { from: number }) => {
  const line = doc.lineAt(node.from);
  const prefix = QUOTE_MARKER.exec(line.text)?.[0] ?? "";
  const matched = ALERT_MARKER.exec(line.text.slice(prefix.length));
  if (!matched) return null;
  const from = line.from + prefix.length;
  return {
    type: matched[1].toLowerCase() as (typeof ALERT_TYPES)[number],
    markerFrom: from,
    markerTo: from + matched[0].length,
  };
};

/** 装饰计算只依赖文档与可见范围，便于脱离真实视图测试 */
type DecorationSource = Pick<EditorView, "state" | "visibleRanges">;

export const buildMarkdownDecorations = (
  view: DecorationSource,
): DecorationSet => {
  const doc = view.state.doc;
  const ranges: Range<Decoration>[] = [];
  type BlockLine = { decoration: Decoration; first: boolean; last: boolean };
  const codeLines = new Map<number, BlockLine>();
  // 嵌套引用会重复覆盖同一行，外层先进入，第一次写入即最终结果
  const quoteLines = new Map<number, BlockLine>();
  const tree = syntaxTree(view.state);

  for (const visible of view.visibleRanges) {
    tree.iterate({
      from: visible.from,
      to: visible.to,
      enter: (node) => {
        if (CODE_BLOCK_NODES.has(node.name)) {
          eachLineInRange(doc, node, visible, (line, first, last) => {
            const existing = codeLines.get(line.from);
            codeLines.set(line.from, {
              decoration: codeLine,
              first: existing?.first || first,
              last: existing?.last || last,
            });
          });
          return;
        }
        if (node.name === "Blockquote") {
          const alert = matchAlert(doc, node);
          const decoration = alert ? alertLines.get(alert.type)! : quoteLine;
          eachLineInRange(doc, node, visible, (line, first, last) => {
            if (quoteLines.has(line.from)) return;
            quoteLines.set(line.from, { decoration, first, last });
          });
          if (alert) {
            ranges.push(alertMarker.range(alert.markerFrom, alert.markerTo));
          }
          return;
        }
        const headingLevel = HEADING_NODE.exec(node.name)?.[1];
        if (headingLevel) {
          // Setext 标题跨两行（正文 + 下划线），两行都要拿到字号
          const decoration = headingLines.get(Number(headingLevel))!;
          eachLineInRange(doc, node, visible, (line) => {
            ranges.push(decoration.range(line.from));
          });
          return;
        }
        if (node.name === "ListMark") {
          ranges.push(listMarker.range(node.from, node.to));
          return;
        }
        if (node.name === "InlineCode") {
          ranges.push(inlineCode.range(node.from, node.to));
        }
      },
    });
  }

  for (const [lineFrom, { decoration, first, last }] of [
    ...codeLines,
    ...quoteLines,
  ]) {
    ranges.push(decoration.range(lineFrom));
    if (first) ranges.push(blockFirst.range(lineFrom));
    if (last) ranges.push(blockLast.range(lineFrom));
  }

  return Decoration.set(ranges, true);
};

export const markdownBlockDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildMarkdownDecorations(view);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = buildMarkdownDecorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);
