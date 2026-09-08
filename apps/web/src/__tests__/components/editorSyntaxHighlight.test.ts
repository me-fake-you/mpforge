/// <reference types="node" />

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { buildMarkdownDecorations } from "../../components/Editor/editorMarkdownDecorations";
import {
  markdownHighlightStyleDark,
  markdownHighlightStyleLight,
} from "../../components/Editor/markdownTheme";
import { underlineExtension } from "../../components/Editor/markdownUnderline";

type DecorationView = Pick<EditorView, "state" | "visibleRanges">;

const createView = (
  doc: string,
  visible?: { from: number; to: number },
): DecorationView => {
  const state = EditorState.create({
    doc,
    extensions: [
      markdown({ base: markdownLanguage, extensions: [underlineExtension] }),
    ],
  });
  return {
    state,
    visibleRanges: [visible ?? { from: 0, to: state.doc.length }],
  } as DecorationView;
};

// 同一行可能落多个 line decoration（块类型 + 首尾标记），
// CodeMirror 会合并它们的 class，这里按行归并以还原真实渲染结果
const collect = (doc: string, visible?: { from: number; to: number }) => {
  const view = createView(doc, visible);
  const byLine = new Map<number, string[]>();
  const marks: { from: number; to: number; classes: string }[] = [];
  const cursor = buildMarkdownDecorations(view).iter();
  while (cursor.value) {
    const spec = cursor.value.spec as { class?: string };
    if (cursor.value.startSide < 0 && cursor.from === cursor.to) {
      const number = view.state.doc.lineAt(cursor.from).number;
      byLine.set(number, [...(byLine.get(number) ?? []), spec.class ?? ""]);
    } else {
      marks.push({
        from: cursor.from,
        to: cursor.to,
        classes: spec.class ?? "",
      });
    }
    cursor.next();
  }
  const lines = [...byLine]
    .sort(([a], [b]) => a - b)
    .map(([line, classes]) => ({ line, classes: classes.join(" ") }));
  return { lines, marks, view };
};

describe("编辑器 Markdown 块级装饰", () => {
  it("围栏代码块的每一行都有底色类，首尾行额外带圆角类", () => {
    const { lines } = collect("正文\n```js\nconst a = 1;\n```\n尾部");
    const codeLines = lines.filter((item) =>
      item.classes.includes("cm-md-code-line"),
    );

    expect(codeLines.map((item) => item.line)).toEqual([2, 3, 4]);
    expect(codeLines[0].classes).toContain("cm-md-block-first");
    expect(codeLines[0].classes).not.toContain("cm-md-block-last");
    expect(codeLines[2].classes).toContain("cm-md-block-last");
    expect(codeLines[1].classes).not.toContain("cm-md-block-first");
  });

  it("单行缩进代码块同时带首尾圆角类", () => {
    const { lines } = collect("正文\n\n    const a = 1;\n");
    const codeLines = lines.filter((item) =>
      item.classes.includes("cm-md-code-line"),
    );

    expect(codeLines).toHaveLength(1);
    expect(codeLines[0].classes).toContain("cm-md-block-first");
    expect(codeLines[0].classes).toContain("cm-md-block-last");
  });

  it("多行引用逐行加左边条类，嵌套引用不重复挂载", () => {
    const { lines } = collect("> 第一行\n> 第二行\n>> 嵌套\n\n正文");
    const quoteLines = lines.filter((item) =>
      item.classes.includes("cm-md-quote-line"),
    );

    expect(quoteLines.map((item) => item.line)).toEqual([1, 2, 3]);
    // 内层嵌套引用不再叠一层，只保留外层引用的样式和首尾标记
    expect(quoteLines[2].classes.split(" ").filter(Boolean)).toEqual([
      "cm-md-quote-line",
      "cm-md-block-last",
    ]);
  });

  it("提示块按类型换一套装饰，并标出 [!TYPE] 标记", () => {
    const { lines, marks, view } = collect(
      "> [!WARNING] 注意图片体积\n> 超过 2MB 会自动压缩。\n\n> 普通引用",
    );

    const alertLines = lines.filter((item) =>
      item.classes.includes("cm-md-alert-line"),
    );
    expect(alertLines.map((item) => item.line)).toEqual([1, 2]);
    expect(alertLines[0].classes).toContain("cm-md-alert-warning");
    expect(alertLines[0].classes).toContain("cm-md-block-first");
    expect(alertLines[1].classes).toContain("cm-md-block-last");
    // 提示块不再叠加普通引用的样式，避免两套底色打架
    expect(alertLines[0].classes).not.toContain("cm-md-quote-line");

    const markerMark = marks.find((mark) =>
      mark.classes.includes("cm-md-alert-marker"),
    );
    expect(markerMark).toBeTruthy();
    expect(view.state.doc.sliceString(markerMark!.from, markerMark!.to)).toBe(
      "[!WARNING]",
    );

    // 普通引用仍走引用样式
    expect(
      lines.some((item) => item.classes.includes("cm-md-quote-line")),
    ).toBe(true);
  });

  it.each(["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"])(
    "识别 %s 提示块，且大小写不敏感",
    (type) => {
      const { lines } = collect(`> [!${type.toLowerCase()}]\n> 内容`);

      expect(lines[0].classes).toContain(`cm-md-alert-${type.toLowerCase()}`);
    },
  );

  it("不把普通引用或未知类型误判成提示块", () => {
    for (const doc of [
      "> 普通引用",
      "> [!UNKNOWN]\n> 内容",
      "> [TIP]\n> 内容",
    ]) {
      const { lines, marks } = collect(doc);
      expect(lines[0].classes).toContain("cm-md-quote-line");
      expect(lines[0].classes).not.toContain("cm-md-alert-line");
      expect(marks.filter((mark) => mark.classes.includes("alert"))).toEqual(
        [],
      );
    }
  });

  it("行内代码整体带装饰，代码块正文不被当作行内代码", () => {
    const { marks, view } = collect("这是 `inline` 代码\n\n```\nplain\n```");

    expect(marks).toHaveLength(1);
    expect(marks[0].classes).toBe("cm-md-inline-code");
    expect(view.state.doc.sliceString(marks[0].from, marks[0].to)).toBe(
      "`inline`",
    );
  });

  it("超长代码块只计算可见范围内的行，首尾圆角仍按真实边界判断", () => {
    const body = Array.from({ length: 400 }, (_, i) => `line ${i}`).join("\n");
    const doc = `前言\n\n\`\`\`\n${body}\n\`\`\`\n`;
    // 只观察代码块中段：既不含开围栏也不含闭围栏
    const middle = doc.indexOf("line 200");
    const { lines } = collect(doc, { from: middle, to: middle + 20 });
    const codeLines = lines.filter((item) =>
      item.classes.includes("cm-md-code-line"),
    );

    expect(codeLines.length).toBeLessThan(5);
    expect(
      codeLines.some((item) => item.classes.includes("cm-md-block-first")),
    ).toBe(false);
    expect(
      codeLines.some((item) => item.classes.includes("cm-md-block-last")),
    ).toBe(false);
  });

  it.each([1, 2, 3, 4, 5, 6])("%s 级标题带对应级别的行装饰", (level) => {
    const { lines } = collect(`${"#".repeat(level)} 标题\n正文`);

    expect(lines[0].classes).toContain("cm-md-heading-line");
    expect(lines[0].classes).toContain(`cm-md-heading-${level}`);
    // 正文行不应被波及
    expect(lines.find((item) => item.line === 2)).toBeUndefined();
  });

  it("Setext 标题的两行都拿到字号", () => {
    const { lines } = collect("标题文字\n===\n正文");
    const headingLines = lines.filter((item) =>
      item.classes.includes("cm-md-heading-1"),
    );

    expect(headingLines.map((item) => item.line)).toEqual([1, 2]);
  });

  // `#` 不做任何尺寸处理：同一行里字号不一致会显得没对齐，
  // 标记靠 processingInstruction 的淡色弱化即可
  it("标题的 # 不加尺寸装饰", () => {
    const { marks } = collect("### 三级标题\n正文");

    expect(marks).toEqual([]);
  });

  // 列表标记表达文档结构，有序列表的数字还携带顺序信息，
  // 不该和 `**`、`` ` `` 这类不携带信息的格式噪音淡化到同一档
  it("列表标记单独装饰，无序与有序都覆盖", () => {
    const { marks, view } = collect("- 无序\n1. 有序\n\n正文 **加粗**");
    const listMarks = marks.filter((mark) =>
      mark.classes.includes("cm-md-list-marker"),
    );

    expect(
      listMarks.map((mark) => view.state.doc.sliceString(mark.from, mark.to)),
    ).toEqual(["-", "1."]);
    // 加粗的 ** 不应被当成列表标记
    expect(listMarks).toHaveLength(2);
  });

  it("任务列表的 - 仍算列表标记", () => {
    const { marks } = collect("- [x] 已完成");

    expect(
      marks.some((mark) => mark.classes.includes("cm-md-list-marker")),
    ).toBe(true);
  });

  it("分隔线不加任何行装饰，只靠 token 淡化", () => {
    const { lines } = collect("段落\n\n---\n\n段落");

    expect(lines).toEqual([]);
  });

  it("引用内的代码块同时保留两种行装饰", () => {
    const { lines } = collect("> ```\n> code\n> ```\n");
    const codeLines = lines.filter((item) =>
      item.classes.includes("cm-md-code-line"),
    );
    const quoteLines = lines.filter((item) =>
      item.classes.includes("cm-md-quote-line"),
    );

    expect(codeLines.length).toBeGreaterThan(0);
    expect(quoteLines.map((item) => item.line)).toEqual([1, 2, 3]);
  });
});

// 标题字号只有 CSS 一个源。任一级别漏掉 --heading-scale，
// calc(1em * var(--heading-scale)) 会整条失效，标题直接没有字号——静默失败。
describe("标题字号契约", () => {
  const editorCss = readFileSync(
    "src/components/Editor/MarkdownEditor.css",
    "utf8",
  );

  it.each([1, 2, 3, 4, 5, 6])("%s 级标题定义了缩放与上间距", (level) => {
    const block = editorCss
      .split("}")
      .find((chunk) => chunk.includes(`.cm-md-heading-${level} `));

    expect(block, `缺少 .cm-md-heading-${level}`).toBeTruthy();
    expect(block).toMatch(/--heading-scale:\s*[\d.]+/);
    expect(block).toMatch(/--heading-space:\s*\d+px/);
  });

  const numbersOf = (name: string) =>
    [...editorCss.matchAll(new RegExp(`--${name}:\\s*([\\d.]+)`, "g"))].map(
      (match) => Number(match[1]),
    );

  it("标题字号自上而下递减", () => {
    const scales = numbersOf("heading-scale");

    expect(scales).toHaveLength(6);
    for (let i = 1; i < scales.length; i++) {
      expect(scales[i]).toBeLessThan(scales[i - 1]);
    }
  });

  // `#` 必须和标题同字号：曾经给标记单独设过尺寸，同一行两种字号看起来像没对齐
  it("不给标记做任何尺寸缩放", () => {
    expect(editorCss).not.toContain("--heading-marker-ratio");
    expect(editorCss).not.toContain("cm-md-heading-marker");
  });
});

describe("编辑器 Markdown 高亮样式", () => {
  const styles = [
    ["浅色", markdownHighlightStyleLight],
    ["深色", markdownHighlightStyleDark],
  ] as const;

  it.each(styles)("%s模式覆盖全部 Markdown 结构 token", (_name, style) => {
    const covered = [
      t.heading1,
      t.heading2,
      t.heading3,
      t.heading4,
      t.heading5,
      t.heading6,
      t.strong,
      t.emphasis,
      t.strikethrough,
      t.link,
      t.url,
      t.labelName,
      t.quote,
      t.list,
      t.monospace,
      t.processingInstruction,
      t.contentSeparator,
    ];

    for (const tag of covered) {
      expect(style.style([tag]), String(tag)).toBeTruthy();
    }
  });

  // lezer-markdown 用 "Blockquote/..." 之类的通配把父 tag 下发给后代，
  // 一个元素会同时挂上继承规则和自身规则，最终由定义顺序决定层叠结果
  it.each(styles)(
    "%s模式按「正文兜底 → 结构 → 标记符号」的顺序定义规则",
    (_name, style) => {
      const rules = style.module?.getRules() ?? "";
      const indexOf = (tag: Parameters<typeof style.style>[0][number]) => {
        const cls = style.style([tag]);
        expect(cls, String(tag)).toBeTruthy();
        return rules.indexOf(`.${cls}`);
      };

      const contentIndex = indexOf(t.content);
      const structureIndexes = [t.heading1, t.heading, t.quote, t.list].map(
        indexOf,
      );
      const markIndex = indexOf(t.processingInstruction);

      for (const structureIndex of structureIndexes) {
        expect(structureIndex).toBeGreaterThan(contentIndex);
        expect(markIndex).toBeGreaterThan(structureIndex);
      }
    },
  );

  // 编辑器背景来自 --bg-primary：浅色 #ffffff，深色 #252526
  const backgrounds = {
    浅色: "#ffffff",
    深色: "#252526",
  } as const;

  const relativeLuminance = (hex: string): number => {
    const value = Number.parseInt(hex.slice(1), 16);
    const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map(
      (channel) => {
        const ratio = channel / 255;
        return ratio <= 0.03928
          ? ratio / 12.92
          : ((ratio + 0.055) / 1.055) ** 2.4;
      },
    );
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };

  const contrastRatio = (foreground: string, background: string): number => {
    const [high, low] = [
      relativeLuminance(foreground),
      relativeLuminance(background),
    ].sort((a, b) => b - a);
    return (high + 0.05) / (low + 0.05);
  };

  const colorOf = (
    style: (typeof styles)[number][1],
    tag: Parameters<typeof style.style>[0][number],
  ) => {
    const cls = style.style([tag]);
    const rule = (style.module?.getRules() ?? "")
      .split("}")
      .find((chunk) => chunk.includes(`.${cls}`));
    return rule?.match(/color:\s*(#[0-9a-f]{6})/i)?.[1];
  };

  // 曾经踩过的坑：正文压到近黑没留余量，加粗只能靠字重；斜体色比正文还浅，
  // 强调反而比周围普通文字更暗淡，方向是反的。这里锁住由重到轻的层级。
  it.each(styles)("%s模式的强调层级方向正确", (name, style) => {
    const background = backgrounds[name];
    const weight = (tag: Parameters<typeof style.style>[0][number]) => {
      const color = colorOf(style, tag);
      expect(color, String(tag)).toBeTruthy();
      return contrastRatio(color!, background);
    };

    const strong = weight(t.strong);
    const content = weight(t.content);
    const quote = weight(t.quote);
    const mark = weight(t.processingInstruction);

    // 加粗必须比正文更突出，且要留出可感知的差距，不能只差一点点
    expect(strong).toBeGreaterThan(content * 1.3);
    // 次要信息依次退后
    expect(content).toBeGreaterThan(quote);
    expect(quote).toBeGreaterThan(mark);

    // 斜体必须与正文有不同的颜色，否则中文（无真斜体，只能合成倾斜）看不出强调
    expect(colorOf(style, t.emphasis)).not.toBe(colorOf(style, t.content));

    // 标题整体要比正文更重
    for (const heading of [t.heading1, t.heading2, t.heading3, t.heading6]) {
      expect(weight(heading), String(heading)).toBeGreaterThan(content);
    }
  });

  it.each(styles)(
    "%s模式的内容色满足 WCAG AA，标记符号淡化后仍不低于 3:1",
    (name, style) => {
      const rules = style.module?.getRules() ?? "";
      const background = backgrounds[name];
      const markClass = style.style([t.processingInstruction]);
      const markColor = rules
        .split("}")
        .find((chunk) => chunk.includes(`.${markClass}`))
        ?.match(/color:\s*(#[0-9a-f]{6})/i)?.[1];

      expect(markColor).toBeTruthy();
      // 标记符号是刻意淡化的语法噪音，只要求可辨识
      expect(contrastRatio(markColor!, background)).toBeGreaterThanOrEqual(3);

      const contentColors = [...rules.matchAll(/color:\s*(#[0-9a-f]{6})/gi)]
        .map((match) => match[1])
        .filter((color) => color.toLowerCase() !== markColor!.toLowerCase());

      expect(contentColors.length).toBeGreaterThan(10);
      for (const color of contentColors) {
        expect(contrastRatio(color, background), color).toBeGreaterThanOrEqual(
          4.5,
        );
      }
    },
  );

  it.each(styles)(
    "%s模式不给 monospace 设背景，避免代码块正文被染成行内代码",
    (_name, style) => {
      const rules = style.module?.getRules() ?? "";
      const monoClass = style.style([t.monospace]);
      const monoRule = rules
        .split("}")
        .find((chunk) => chunk.includes(`.${monoClass}`));

      expect(monoRule).toBeTruthy();
      expect(monoRule).not.toMatch(/background/i);
      expect(monoRule).not.toMatch(/color:/i);
    },
  );
});
