export interface TextRange {
  from: number;
  to: number;
  /** 由编辑器事务持续映射的审阅建议锚点 */
  anchorId?: string;
}

export type QuoteMatch =
  | { status: "unique"; range: TextRange }
  | { status: "ambiguous"; ranges: TextRange[] }
  | { status: "missing" };

/**
 * 模型摘引用时会顺手改标点、补省略号、全半角互换，精确匹配一个字不同就整条失效。
 * 归一化后匹配，再用偏移表映射回原文的真实位置。
 */
const PUNCT_MAP: Record<string, string> = {
  "，": ",",
  "。": ".",
  "！": "!",
  "？": "?",
  "；": ";",
  "：": ":",
  "（": "(",
  "）": ")",
  "、": ",",
  "“": '"',
  "”": '"',
  "‘": "'",
  "’": "'",
  "—": "-",
  "－": "-",
  "～": "~",
};

/**
 * 成对包裹文字、本身不产生内容的行内标记。模型引用的是渲染后的纯文本，
 * 正文里的 `**` 会卡在引用中间导致匹配不上。
 * 不含 []()：链接的 URL 是真实内容，跨过它匹配会算出错误的区间，宁可定位失败。
 * 不含 #>：它们只出现在行首，不会夹在引用内部。
 */
const MARKUP = /[*_~=`^]/;

interface Normalized {
  text: string;
  /** normalized[i] 在原文中的下标 */
  offsets: number[];
}

function normalize(input: string): Normalized {
  const chars: string[] = [];
  const offsets: number[] = [];

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (/\s/.test(char) || MARKUP.test(char)) continue;
    chars.push((PUNCT_MAP[char] ?? char).toLowerCase());
    offsets.push(i);
  }

  return { text: chars.join(""), offsets };
}

/** 尾部省略号是模型截断留下的，不属于原文 */
const TRAILING_ELLIPSIS = /(\.{3,}|…+|等+)$/;

/** 低于这个长度的片段太容易撞上无关位置，宁可定位失败 */
const MIN_MATCH_CHARS = 6;
/** 整段匹配不上时退而求其次的前缀长度 */
const PREFIX_CHARS = 12;

function searchAll(doc: Normalized, needle: string): TextRange[] {
  if (!needle) return [];
  const ranges: TextRange[] = [];
  let from = 0;
  while (from <= doc.text.length - needle.length) {
    const index = doc.text.indexOf(needle, from);
    if (index < 0) break;
    const last = doc.offsets[index + needle.length - 1];
    ranges.push({ from: doc.offsets[index], to: last + 1 });
    from = index + 1;
  }
  return ranges;
}

/**
 * 把紧挨边界的标记并进区间。
 * 引用是纯文本，算出的区间会落在 `**` 内侧，替换后前半个 `**` 就成了没闭合的
 * 标记，会把后文整段染成粗体。整对吃掉即可：新文字本来也不带原来的格式。
 */
function absorbMarkup(doc: string, range: TextRange): TextRange {
  let { from, to } = range;
  while (from > 0 && MARKUP.test(doc[from - 1])) from -= 1;
  while (to < doc.length && MARKUP.test(doc[to])) to += 1;
  return { from, to };
}

/**
 * 在正文中定位模型给出的引用。
 * 找不到返回 null，由调用方如实告诉用户「未能定位到原文」，不要静默失败。
 */
export function locateQuoteMatch(doc: string, quote: string): QuoteMatch {
  const cleaned = quote.trim().replace(TRAILING_ELLIPSIS, "");
  if (cleaned.length < MIN_MATCH_CHARS) return { status: "missing" };

  const exactRanges: TextRange[] = [];
  let exactFrom = 0;
  while (exactFrom <= doc.length - cleaned.length) {
    const index = doc.indexOf(cleaned, exactFrom);
    if (index < 0) break;
    exactRanges.push(
      absorbMarkup(doc, {
        from: index,
        to: index + cleaned.length,
      }),
    );
    exactFrom = index + 1;
  }
  if (exactRanges.length > 0) return toQuoteMatch(exactRanges);

  const normalizedDoc = normalize(doc);
  const normalizedQuote = normalize(cleaned).text;
  const normalizedRanges = searchAll(normalizedDoc, normalizedQuote).map(
    (range) => absorbMarkup(doc, range),
  );
  if (normalizedRanges.length > 0) return toQuoteMatch(normalizedRanges);

  const prefixRanges = searchAll(
    normalizedDoc,
    normalizedQuote.slice(0, PREFIX_CHARS),
  ).map((range) => absorbMarkup(doc, range));
  return prefixRanges.length > 0
    ? toQuoteMatch(prefixRanges)
    : { status: "missing" };
}

function toQuoteMatch(ranges: TextRange[]): QuoteMatch {
  const unique = new Map(
    ranges.map((range) => [`${range.from}:${range.to}`, range]),
  );
  const deduped = [...unique.values()];
  return deduped.length === 1
    ? { status: "unique", range: deduped[0] }
    : { status: "ambiguous", ranges: deduped };
}

/** 兼容只需要唯一位置的调用方；歧义位置一律不自动猜测。 */
export function locateQuote(doc: string, quote: string): TextRange | null {
  const result = locateQuoteMatch(doc, quote);
  return result.status === "unique" ? result.range : null;
}
