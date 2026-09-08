import { describe, expect, it } from "vitest";

import {
  SCORE_SYSTEM_PROMPT,
  TITLE_DIRECTIONS,
  TITLE_SYSTEM_PROMPT,
  buildScoreMessages,
  buildTitleMessages,
  parseScoreReport,
  parseTitleCandidates,
} from "../../services/ai/aiPrompts";
import {
  MAX_DOCUMENT_CHARS,
  MAX_TITLE_CHARS,
  findFirstHeading,
  formatDocumentMetrics,
  getDocumentMetrics,
  prepareDocument,
} from "../../services/ai/aiSelection";

describe("评分 prompt 约束", () => {
  it("禁止空话建议，要求说清为什么要改", () => {
    expect(SCORE_SYSTEM_PROMPT).toContain("禁止「可以更清晰」");
  });

  it("要求建议紧跟它所属的维度输出，不堆到最后", () => {
    expect(SCORE_SYSTEM_PROMPT).toContain("写完一个维度再写下一个");
  });

  it("只引用确定性统计，并要求引用唯一可定位", () => {
    expect(SCORE_SYSTEM_PROMPT).toContain("只能逐字引用【文章统计】");
    expect(SCORE_SYSTEM_PROMPT).toContain("能够唯一定位");
  });

  it("绑定总评与非好维度，不评价选题", () => {
    expect(SCORE_SYSTEM_PROMPT).toContain("TOP 必须绑定一条档位非「好」的 DIM");
    expect(SCORE_SYSTEM_PROMPT).toContain("不评价选题");
  });

  it("建议要给出可直接替换的成品文字，否则采纳按钮没东西可写回", () => {
    expect(SCORE_SYSTEM_PROMPT).toContain("可以直接替换");
  });

  it("只改局部，不要求输出全文", () => {
    expect(SCORE_SYSTEM_PROMPT).toContain("不要输出修改后的全文");
  });

  it("不出现百分制或分数字样", () => {
    expect(SCORE_SYSTEM_PROMPT).not.toMatch(/分数|100 分|百分/);
  });
});

describe("评分输出解析", () => {
  const raw = [
    "TOP|开头|基于当前的内容创作环境而言|开头绕了三行才进入正题",
    "DIM|开头|一般|前 3 行|基于当前的内容创作环境而言",
    "FIX|开头|前两句是铺垫，直接说读者能得到什么|现在做公众号，最难的是",
    "DIM|结构|好|4 个小标题|—",
    "DIM|节奏|待改进|最长段 218 字|很多创作者往往会把绝大部分",
    "FIX|结构|把并列的四点提成小标题|—",
    "DIM|表达|待改进|—|综上所述",
    "DIM|结尾|一般|—|排版的重要性不言而喻",
  ].join("\n");

  it("解析出总评、五个维度与建议", () => {
    const report = parseScoreReport(raw);
    expect(report.top).toBe("开头绕了三行才进入正题");
    expect(report.dimensions.map((d) => d.id)).toEqual([
      "opening",
      "structure",
      "rhythm",
      "wording",
      "ending",
    ]);
    expect(report.dimensions.filter((d) => d.fix)).toHaveLength(2);
  });

  it("总评未绑定同一条非好维度时丢弃，避免另起一套判断", () => {
    const report = parseScoreReport(
      [
        "TOP|结构|—|结构需要调整",
        "DIM|开头|一般|开头前三个正文行：12 字|原文引用",
      ].join("\n"),
    );
    expect(report.top).toBe("");
  });

  it("建议挂到对应维度上，替换目标就是该维度的引用", () => {
    const report = parseScoreReport(raw);
    const opening = report.dimensions.find((d) => d.id === "opening")!;
    expect(opening.quote).toBe("基于当前的内容创作环境而言");
    expect(opening.fix).toEqual({
      advice: "前两句是铺垫，直接说读者能得到什么",
      replacement: "现在做公众号，最难的是",
    });
  });

  it("改不动的维度只给建议，替换文本为空", () => {
    const report = parseScoreReport(raw);
    const structure = report.dimensions.find((d) => d.id === "structure")!;
    expect(structure.fix).toEqual({
      advice: "把并列的四点提成小标题",
      replacement: "",
    });
  });

  it("FIX 出现在 DIM 之前也能挂上，不依赖模型的输出顺序", () => {
    const report = parseScoreReport(
      ["FIX|开头|先说结论|新的开头", "DIM|开头|一般|前 3 行|旧的开头"].join(
        "\n",
      ),
    );
    expect(report.dimensions[0].fix?.replacement).toBe("新的开头");
  });

  it("替换文本里出现竖线时不被截断", () => {
    const report = parseScoreReport(
      [
        "DIM|开头|一般|前 3 行|旧的开头",
        "FIX|开头|问题描述|改写 a|b 收尾",
      ].join("\n"),
    );
    expect(report.dimensions[0].fix?.replacement).toBe("改写 a|b 收尾");
  });

  it("替换文本原样抄回引用时按「只有建议」处理，不给一个点了没用的采纳", () => {
    const report = parseScoreReport(
      [
        "DIM|结构|一般|6 个小标题|从规模建设走向统一调度",
        "FIX|结构|小标题是背景陈述，改为动词开头的行动句| 从规模建设走向统一调度 ",
      ].join("\n"),
    );
    expect(report.dimensions[0].fix).toEqual({
      advice: "小标题是背景陈述，改为动词开头的行动句",
      replacement: "",
    });
  });

  it("只改标点或加粗仍算有效改写，不能当成回显丢掉", () => {
    const punctuation = parseScoreReport(
      [
        "DIM|表达|一般|—|让更多算力实现可连接，，可调度",
        "FIX|表达|连续逗号|让更多算力实现可连接、可调度",
      ].join("\n"),
    );
    expect(punctuation.dimensions[0].fix?.replacement).toBe(
      "让更多算力实现可连接、可调度",
    );

    const bold = parseScoreReport(
      ["DIM|表达|一般|—|超智算科技", "FIX|表达|品牌名加粗|**超智算科技**"].join(
        "\n",
      ),
    );
    expect(bold.dimensions[0].fix?.replacement).toBe("**超智算科技**");
  });

  it("维度名对不上的建议直接丢掉，不挂到别的维度上", () => {
    const report = parseScoreReport(
      ["DIM|开头|一般|前 3 行|旧的开头", "FIX|不存在的维度|建议|替换"].join(
        "\n",
      ),
    );
    expect(report.dimensions[0].fix).toBeUndefined();
  });

  it("档位映射为内部枚举", () => {
    const report = parseScoreReport(raw);
    expect(report.dimensions[0].grade).toBe("fair");
    expect(report.dimensions[1].grade).toBe("good");
    expect(report.dimensions[2].grade).toBe("poor");
  });

  it("破折号占位视为空，不当成引用显示", () => {
    const report = parseScoreReport(raw);
    expect(report.dimensions[1].quote).toBe("");
    expect(report.dimensions[3].metric).toBe("");
  });

  it("流式期间可增量解析，且第一个维度一次性成型", () => {
    const partial = raw.split("\n").slice(0, 3).join("\n");
    const report = parseScoreReport(partial);
    expect(report.top).not.toBe("");
    expect(report.dimensions).toHaveLength(1);
    expect(report.dimensions[0].fix?.replacement).toBe(
      "现在做公众号，最难的是",
    );
  });

  it("容忍全角竖线、列表符号、序号与代码围栏", () => {
    const drifted = [
      "```",
      "- TOP｜开头｜引用内容｜开头绕了三行",
      "1. DIM｜开头｜一般｜前 3 行｜引用内容",
      "* DIM│结构│好│4 个小标题│—",
      "2、FIX｜开头｜删掉铺垫｜现在做公众号",
      "```",
    ].join("\n");
    const report = parseScoreReport(drifted);
    expect(report.top).toBe("开头绕了三行");
    expect(report.dimensions.map((d) => d.label)).toEqual(["开头", "结构"]);
    expect(report.dimensions[0].fix).toEqual({
      advice: "删掉铺垫",
      replacement: "现在做公众号",
    });
  });

  it("忽略未知维度、缺档位与重复行", () => {
    const messy = [
      "DIM|开头|一般|前 3 行|引用",
      "DIM|开头|好|重复行|—",
      "DIM|排版|好|—|—",
      "DIM|结构||—|—",
      "随便一行噪声",
    ].join("\n");
    const report = parseScoreReport(messy);
    expect(report.dimensions).toHaveLength(1);
    expect(report.dimensions[0].grade).toBe("fair");
  });
});

describe("标题 prompt 约束", () => {
  it("点名五个方向，避免产出雷同标题", () => {
    for (const direction of TITLE_DIRECTIONS) {
      expect(TITLE_SYSTEM_PROMPT).toContain(direction.label);
    }
    expect(TITLE_SYSTEM_PROMPT).toContain("不同的正文切入点或读者收益");
  });

  it("写入公众号 64 字上限与推荐长度", () => {
    expect(MAX_TITLE_CHARS).toBe(64);
    expect(TITLE_SYSTEM_PROMPT).toContain(`不超过 ${MAX_TITLE_CHARS} 字`);
    expect(TITLE_SYSTEM_PROMPT).toContain("16 到 28 个汉字");
  });

  it("无可信数字时允许明确标为不适用", () => {
    expect(TITLE_SYSTEM_PROMPT).toContain("数字|—");
    expect(TITLE_SYSTEM_PROMPT).toContain("不得编造数量");
  });

  it("PICK 基于文章主线且不能选择不适用候选", () => {
    expect(TITLE_SYSTEM_PROMPT).toContain("PICK 不能选「—」");
    expect(TITLE_SYSTEM_PROMPT).toContain("最贴近文章主线");
  });

  it("明令禁止标题党写法与虚假承诺", () => {
    expect(TITLE_SYSTEM_PROMPT).toContain("禁止标题党");
    expect(TITLE_SYSTEM_PROMPT).toContain("震惊");
    expect(TITLE_SYSTEM_PROMPT).toContain("不承诺正文没有提供的内容");
    expect(TITLE_SYSTEM_PROMPT).toContain("虚假时效");
  });
});

describe("标题候选解析", () => {
  const raw = [
    "疑问|为什么你的公众号排版总差一口气？",
    "直给|用 Markdown 写公众号，排版不再返工",
    "数字|公众号排版的 5 个细节",
    "反差|排版好不好，跟内容质量无关",
    "场景|写完文章，卡在排版这一步",
  ].join("\n");

  it("推荐项由 PICK 行决定，而不是输出顺序", () => {
    const { candidates, picked, pickReason } = parseTitleCandidates(
      `${raw}\nPICK|反差|读者对排版有固有印象`,
    );
    expect(candidates).toHaveLength(5);
    expect(candidates[0].direction).toBe("question");
    expect(picked).toBe("contrast");
    expect(pickReason).toBe("读者对排版有固有印象");
  });

  it("没有 PICK 行时不标推荐，不拿顺序冒充判断", () => {
    const { picked, pickReason } = parseTitleCandidates(raw);
    expect(picked).toBeUndefined();
    expect(pickReason).toBeUndefined();
  });

  it("PICK 指向不存在的候选时作废", () => {
    const { picked } = parseTitleCandidates("直给|标题\nPICK|场景|理由");
    expect(picked).toBeUndefined();
  });

  it("标出字数并标记超限", () => {
    const { candidates } = parseTitleCandidates(raw);
    expect(candidates[0].length).toBe(candidates[0].title.length);
    expect(candidates.every((c) => !c.overLimit)).toBe(true);

    const tooLong = parseTitleCandidates(`直给|${"标".repeat(70)}`);
    expect(tooLong.candidates[0].overLimit).toBe(true);
  });

  it("标题里含竖线时不被截断", () => {
    const { candidates } = parseTitleCandidates("直给|排版 | 一个被低估的环节");
    expect(candidates[0].title).toBe("排版 | 一个被低估的环节");
  });

  it("标题同样容忍全角竖线与列表符号", () => {
    const drifted = [
      "- 疑问｜为什么排版总差一口气？",
      "1. 直给│直接说清价值",
    ].join("\n");
    const { candidates } = parseTitleCandidates(drifted);
    expect(candidates.map((c) => c.title)).toEqual([
      "为什么排版总差一口气？",
      "直接说清价值",
    ]);
  });

  it("忽略未知方向、空标题与重复方向", () => {
    const messy = [
      "直给|正常标题",
      "直给|重复方向",
      "标题党|不该出现",
      "疑问|",
      "没有竖线的行",
    ].join("\n");
    const { candidates } = parseTitleCandidates(messy);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].title).toBe("正常标题");
  });

  it("数字方向可标为不适用，且不能被推荐", () => {
    const { candidates, picked } = parseTitleCandidates(
      "数字|—\nPICK|数字|本文没有可验证数字",
    );
    expect(candidates[0]).toMatchObject({
      direction: "number",
      unavailable: true,
      length: 0,
    });
    expect(picked).toBeUndefined();
  });
});

describe("全文与标题定位", () => {
  it("正文超限时截断并告知，不静默丢弃", () => {
    const long = "字".repeat(MAX_DOCUMENT_CHARS + 500);
    const payload = prepareDocument(long);
    expect(payload.truncated).toBe(true);
    expect(payload.text).toHaveLength(MAX_DOCUMENT_CHARS);
    expect(payload.totalChars).toBe(long.length);
  });

  it("正文未超限时原样发送", () => {
    const payload = prepareDocument("短文");
    expect(payload.truncated).toBe(false);
    expect(payload.text).toBe("短文");
  });

  it("统计只覆盖可见正文，不把元数据和代码算进事实", () => {
    const metrics = getDocumentMetrics(`---
title: 草稿
---
# 标题
第一段
第二行

## 小标题
- 列表项

第三段
\`\`\`ts
const ignored = "代码";
\`\`\``);

    expect(metrics).toEqual({
      paragraphCount: 2,
      subheadingCount: 1,
      longestParagraphChars: 6,
      openingChars: 9,
      listItemCount: 1,
    });
    expect(formatDocumentMetrics(metrics)).toContain("最长正文段落：6 字");
  });

  it("未闭合的开头分隔线仍按正文统计", () => {
    expect(getDocumentMetrics("---\n正文")).toMatchObject({
      paragraphCount: 1,
      longestParagraphChars: 2,
    });
  });

  it("定位正文第一个一级标题", () => {
    const doc = "前言\n\n# 真正的标题\n\n正文\n\n# 第二个标题";
    const heading = findFirstHeading(doc);
    expect(heading?.text).toBe("真正的标题");
    expect(doc.slice(heading!.from, heading!.to)).toBe("# 真正的标题");
  });

  it("二级标题不算，无一级标题时返回 null", () => {
    expect(findFirstHeading("## 二级标题\n\n正文")).toBeNull();
    expect(findFirstHeading("没有任何标题")).toBeNull();
  });

  it("消息附带确定性统计，只发送正文不夹带当前标题", () => {
    const score = buildScoreMessages("正文内容");
    expect(score[1].content).toContain("正文段落：1");
    expect(score[1].content).toContain("正文内容");

    const title = buildTitleMessages("正文内容");
    expect(title[1].content).toContain("正文段落：1");
    expect(title[1].content).toContain("正文内容");
    expect(title[1].content).not.toContain("当前标题");
  });
});
