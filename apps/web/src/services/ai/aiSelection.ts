export const MIN_SELECTION_CHARS = 4;
export const MAX_SELECTION_CHARS = 4000;
export const CONTEXT_CHARS = 500;

/** 全文类动作的长度上限，超出只取前 N 字并明确告知，不静默截断 */
export const MAX_DOCUMENT_CHARS = 12000;

/** 微信公众号标题字数上限 */
export const MAX_TITLE_CHARS = 64;

export interface DocumentPayload {
  text: string;
  truncated: boolean;
  totalChars: number;
}

export function prepareDocument(
  doc: string,
  limit: number = MAX_DOCUMENT_CHARS,
): DocumentPayload {
  const totalChars = doc.length;
  if (totalChars <= limit) {
    return { text: doc, truncated: false, totalChars };
  }
  return { text: doc.slice(0, limit), truncated: true, totalChars };
}

/** 新建文章的占位标题，出现这些时视为「还没起过标题」 */
const PLACEHOLDER_TITLES = ["新文章", "未命名文章"];

export function isPlaceholderTitle(title: string): boolean {
  const trimmed = title.trim();
  return !trimmed || PLACEHOLDER_TITLES.includes(trimmed);
}

/** 取正文第一个一级标题，供标题优化定位替换目标 */
export function findFirstHeading(
  doc: string,
): { from: number; to: number; text: string } | null {
  const match = /^#[ \t]+(.+?)[ \t]*$/m.exec(doc);
  if (!match) return null;

  const from = match.index;
  return { from, to: from + match[0].length, text: match[1].trim() };
}

interface LineInfo {
  from: number;
  to: number;
  text: string;
  insideFence: boolean;
}

const FENCE_PATTERN = /^\s*(```|~~~)/;

function toLines(doc: string): LineInfo[] {
  const lines: LineInfo[] = [];
  let from = 0;
  let insideFence = false;

  for (const text of doc.split("\n")) {
    const isFenceMarker = FENCE_PATTERN.test(text);
    // 围栏标记行本身也算块内，避免把 ``` 当成正文
    const lineInsideFence = insideFence || isFenceMarker;
    lines.push({
      from,
      to: from + text.length,
      text,
      insideFence: lineInsideFence,
    });

    if (isFenceMarker) insideFence = !insideFence;
    from += text.length + 1;
  }

  return lines;
}

export interface DocumentMetrics {
  paragraphCount: number;
  subheadingCount: number;
  longestParagraphChars: number;
  openingChars: number;
  listItemCount: number;
}

const HEADING_PATTERN = /^(#{1,6})\s+/;
const LIST_ITEM_PATTERN = /^\s*(?:[-*+]\s+|\d+[.)]\s+)/;
const HORIZONTAL_RULE_PATTERN = /^(?:[-*_]\s*){3,}$/;

/** 只跳过元数据和代码块，避免它们污染正文统计。 */
export function getDocumentMetrics(doc: string): DocumentMetrics {
  const lines = doc.split("\n");
  const openingLines: string[] = [];
  const frontmatterEnd =
    lines[0]?.trim() === "---"
      ? lines.findIndex((line, index) => index > 0 && line.trim() === "---")
      : -1;
  let insideFence = false;
  let paragraph: string[] = [];
  let paragraphCount = 0;
  let subheadingCount = 0;
  let longestParagraphChars = 0;
  let listItemCount = 0;

  const finishParagraph = () => {
    const chars = paragraph.join("").length;
    if (chars > 0) {
      paragraphCount += 1;
      longestParagraphChars = Math.max(longestParagraphChars, chars);
    }
    paragraph = [];
  };

  for (const [index, line] of lines.entries()) {
    if (index <= frontmatterEnd) continue;
    const trimmed = line.trim();

    if (FENCE_PATTERN.test(line)) {
      finishParagraph();
      insideFence = !insideFence;
      continue;
    }
    if (insideFence) continue;
    if (!trimmed) {
      finishParagraph();
      continue;
    }
    if (HORIZONTAL_RULE_PATTERN.test(trimmed)) {
      finishParagraph();
      continue;
    }

    const heading = HEADING_PATTERN.exec(trimmed);
    if (heading) {
      finishParagraph();
      if (heading[1].length > 1) subheadingCount += 1;
      continue;
    }
    if (LIST_ITEM_PATTERN.test(trimmed)) {
      finishParagraph();
      listItemCount += 1;
      continue;
    }

    const visible = trimmed.replace(/^(?:>\s*)+/, "");
    if (!visible) continue;
    paragraph.push(visible);
    if (openingLines.length < 3) openingLines.push(visible);
  }
  finishParagraph();

  return {
    paragraphCount,
    subheadingCount,
    longestParagraphChars,
    openingChars: openingLines.join("").length,
    listItemCount,
  };
}

export function formatDocumentMetrics(metrics: DocumentMetrics): string {
  return [
    `正文段落：${metrics.paragraphCount}`,
    `二级及以下小标题：${metrics.subheadingCount}`,
    `最长正文段落：${metrics.longestParagraphChars} 字`,
    `开头前三个正文行：${metrics.openingChars} 字`,
    `列表项：${metrics.listItemCount}`,
  ].join("\n");
}

function lineIndexAt(lines: LineInfo[], pos: number): number {
  for (let i = 0; i < lines.length; i += 1) {
    if (pos <= lines[i].to) return i;
  }
  return lines.length - 1;
}

export function isInsideCodeFence(doc: string, pos: number): boolean {
  const lines = toLines(doc);
  return lines[lineIndexAt(lines, pos)].insideFence;
}

export interface SelectionContext {
  before: string;
  after: string;
}

// 只取前后各一段，不发送全文
export function extractContext(
  doc: string,
  from: number,
  to: number,
  limit: number = CONTEXT_CHARS,
): SelectionContext {
  const beforeStart = Math.max(0, from - limit);
  let before = doc.slice(beforeStart, from);
  // 从行边界起算，避免半句进入上下文
  if (beforeStart > 0) {
    const boundary = before.indexOf("\n");
    before = boundary >= 0 ? before.slice(boundary + 1) : "";
  }

  const afterEnd = Math.min(doc.length, to + limit);
  let after = doc.slice(to, afterEnd);
  if (afterEnd < doc.length) {
    const boundary = after.lastIndexOf("\n");
    after = boundary >= 0 ? after.slice(0, boundary) : "";
  }

  return { before: before.trim(), after: after.trim() };
}

export type SelectionCheck =
  | { ok: true }
  | { ok: false; reason: "too-short" | "too-long" | "inside-code-fence" };

// 浮标显隐与执行前校验共用这一处
export function checkSelection(
  doc: string,
  from: number,
  to: number,
): SelectionCheck {
  const length = to - from;
  if (length < MIN_SELECTION_CHARS) return { ok: false, reason: "too-short" };
  if (length > MAX_SELECTION_CHARS) return { ok: false, reason: "too-long" };
  if (isInsideCodeFence(doc, from)) {
    return { ok: false, reason: "inside-code-fence" };
  }
  return { ok: true };
}
