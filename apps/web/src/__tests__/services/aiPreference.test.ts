import { describe, expect, it } from "vitest";

import {
  buildRewriteMessages,
  buildScoreMessages,
  buildTitleMessages,
  MAX_PREFERENCE_CHARS,
  SCORE_SYSTEM_PROMPT,
} from "../../services/ai/aiPrompts";

const PREF = "读者是产品经理；不要口语化";
const system = (messages: { role: string; content: string }[] | null) =>
  messages!.find((m) => m.role === "system")!.content;

describe("写作偏好拼接", () => {
  it("留空时整块不拼，不给模型多余上下文", () => {
    expect(buildScoreMessages("正文")[0].content).toBe(SCORE_SYSTEM_PROMPT);
    expect(SCORE_SYSTEM_PROMPT).not.toContain("作者偏好");
  });

  it("只有空白也当作留空", () => {
    expect(system(buildScoreMessages("正文", "   \n "))).not.toContain(
      "作者偏好",
    );
  });

  it("三个动作都会带上偏好", () => {
    expect(system(buildScoreMessages("正文", PREF))).toContain(PREF);
    expect(system(buildTitleMessages("正文", PREF))).toContain(PREF);
    expect(
      system(
        buildRewriteMessages({ action: "polish", selected: "一段话" }, PREF),
      ),
    ).toContain(PREF);
  });

  it("偏好排在输出格式之前，用户写的结构性要求盖不掉解析协议", () => {
    const prompt = system(buildScoreMessages("正文", PREF));
    expect(prompt.indexOf("【作者偏好】")).toBeLessThan(
      prompt.indexOf("输出格式，严格逐行输出"),
    );
    expect(prompt).toContain("两者冲突时以输出格式为准");
  });

  it("超长偏好被截断，不把整个提示词撑爆", () => {
    const prompt = system(buildScoreMessages("正文", "字".repeat(400)));
    expect(prompt).toContain("字".repeat(MAX_PREFERENCE_CHARS));
    expect(prompt).not.toContain("字".repeat(MAX_PREFERENCE_CHARS + 1));
  });

  it("拼上偏好后输出格式与字段规则原样保留", () => {
    const prompt = system(buildScoreMessages("正文", PREF));
    expect(prompt).toContain("DIM|维度名|档位|客观计量|原文引用");
    expect(prompt).toContain("FIX|维度名|建议一句话|改写后的片段");
  });
});
