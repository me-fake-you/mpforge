// 编辑器侧的数学公式语法识别
//
// lezer-markdown 是标准 CommonMark + GFM，不认识 `$...$` 和 `$$...$$`——
// 公式是 WeMD 通过 markdown-it 插件扩展的能力，编辑器里必须单独教一遍。
// 分隔符判定规则必须与 packages/core 的 markdown-it-math.ts 对齐，
// 否则会出现"编辑器高亮了但渲染不认"或反过来的不一致。
import type {
  BlockContext,
  InlineContext,
  Line,
  MarkdownExtension,
} from "@lezer/markdown";
import { Tag, tags } from "@lezer/highlight";

// 只能从未经修饰的 tag 派生，Tag.define(tags.special(...)) 会直接抛错
export const mathTag = Tag.define(tags.content);
export const mathMarkTag = Tag.define(tags.processingInstruction);

const DOLLAR = "$".charCodeAt(0);
const BACKSLASH = "\\".charCodeAt(0);
const SPACE = " ".charCodeAt(0);
const TAB = "\t".charCodeAt(0);
const ZERO = "0".charCodeAt(0);
const NINE = "9".charCodeAt(0);

const isSpace = (ch: number) => ch === SPACE || ch === TAB;

/**
 * 与 core 的 isValidDelim 等价：
 * 开定界符后面不能是空白；闭定界符前面不能是空白，且后面不能跟数字
 * （后者是"售价 $99"这类货币写法的保护）。
 */
const canOpen = (cx: InlineContext, pos: number) => !isSpace(cx.char(pos + 1));

const canClose = (cx: InlineContext, pos: number) => {
  if (isSpace(cx.char(pos - 1))) return false;
  const next = cx.char(pos + 1);
  return !(next >= ZERO && next <= NINE);
};

/** 反斜杠个数为偶数时该 `$` 才是真的分隔符 */
const isEscaped = (cx: InlineContext, pos: number) => {
  let backslashes = 0;
  while (cx.char(pos - 1 - backslashes) === BACKSLASH) backslashes++;
  return backslashes % 2 === 1;
};

const parseMathInline = (cx: InlineContext, next: number, pos: number) => {
  if (next !== DOLLAR || !canOpen(cx, pos)) return -1;
  if (isEscaped(cx, pos)) return -1;

  const start = pos + 1;
  for (let i = start; i < cx.end; i++) {
    if (cx.char(i) !== DOLLAR || isEscaped(cx, i)) continue;
    // 空内容 `$$` 不解析，与 core 一致
    if (i === start) return -1;
    if (!canClose(cx, i)) return -1;
    return cx.addElement(
      cx.elt("MathInline", pos, i + 1, [
        cx.elt("MathMark", pos, start),
        cx.elt("MathMark", i, i + 1),
      ]),
    );
  }
  return -1;
};

const endsWithFence = (text: string) => text.trimEnd().endsWith("$$");

/**
 * Lezer 内置块解析器也用 depth 判断是否仍在父容器内；该运行时字段未暴露在类型声明中。
 */
const staysInParentContainer = (cx: BlockContext, line: Line) =>
  (line as Line & { readonly depth: number }).depth >= cx.depth;

const parseMathBlock = (cx: BlockContext, line: Line) => {
  if (line.next !== DOLLAR) return false;
  if (line.text.charCodeAt(line.pos + 1) !== DOLLAR) return false;

  const from = cx.lineStart + line.pos;
  const marks = [cx.elt("MathMark", from, from + 2)];
  const rest = line.text.slice(line.pos + 2);

  // 单行形式：$$ ... $$，公式体允许为空（`$$$$`），与 core 的判定一致
  if (endsWithFence(rest)) {
    const closeAt = cx.lineStart + line.text.lastIndexOf("$$");
    marks.push(cx.elt("MathMark", closeAt, closeAt + 2));
    const to = closeAt + 2;
    cx.nextLine();
    cx.addElement(cx.elt("MathBlock", from, to, marks));
    return true;
  }

  // 多行形式：向后扫描到某行以 $$ 结尾，但不能越过列表、引用等父容器边界
  while (cx.nextLine() && staysInParentContainer(cx, line)) {
    if (!endsWithFence(line.text)) continue;
    const closeAt = cx.lineStart + line.text.lastIndexOf("$$");
    marks.push(cx.elt("MathMark", closeAt, closeAt + 2));
    const to = closeAt + 2;
    cx.nextLine();
    cx.addElement(cx.elt("MathBlock", from, to, marks));
    return true;
  }

  // 到当前父容器末尾仍未闭合：与 core 一致，公式块延伸到该解析范围末尾。
  // 这里不能返回 false——lezer 的 block parser 返回 false 表示"这一行没被消费"，
  // 而上面的 nextLine() 已推进了解析上下文，返回 false 会让整篇文档建不出语法树。
  cx.addElement(cx.elt("MathBlock", from, cx.prevLineEnd(), marks));
  return true;
};

export const mathExtension: MarkdownExtension = {
  defineNodes: [
    { name: "MathInline", style: { "MathInline/...": mathTag } },
    { name: "MathBlock", block: true, style: { "MathBlock/...": mathTag } },
    { name: "MathMark", style: mathMarkTag },
  ],
  parseInline: [{ name: "MathInline", parse: parseMathInline }],
  parseBlock: [{ name: "MathBlock", parse: parseMathBlock }],
};
