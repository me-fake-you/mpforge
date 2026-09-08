import { describe, expect, it } from "vitest";

import {
  MAX_INSTRUCTION_CHARS,
  REWRITE_ACTIONS,
  REWRITE_SYSTEM_PROMPT,
  TONE_OPTIONS,
  buildRewriteMessages,
  resolveInstruction,
  sanitizeRewriteOutput,
} from "../../services/ai/aiPrompts";

describe("System 约束", () => {
  it("明令禁止新增 Markdown 标记", () => {
    expect(REWRITE_SYSTEM_PROMPT).toContain("不新增任何 Markdown 标记");
    expect(REWRITE_SYSTEM_PROMPT).toContain("加高亮");
  });

  it("要求无关指令原样返回原文，挡住乱输入与越权指令", () => {
    expect(REWRITE_SYSTEM_PROMPT).toContain("与改写无关");
    expect(REWRITE_SYSTEM_PROMPT).toContain("原样返回原文");
    expect(REWRITE_SYSTEM_PROMPT).toContain("忽略以上规则");
  });

  it("要求保留块级标记与代码公式，且只输出正文", () => {
    expect(REWRITE_SYSTEM_PROMPT).toContain("块级 Markdown 标记必须原样保留");
    expect(REWRITE_SYSTEM_PROMPT).toContain("代码块、行内代码、数学公式");
    expect(REWRITE_SYSTEM_PROMPT).toContain("只输出改写后的文本本身");
  });
});

describe("动作与指令", () => {
  it("四个预设动作齐备且换语气有四种语气", () => {
    expect(REWRITE_ACTIONS.map((a) => a.id)).toEqual([
      "polish",
      "condense",
      "colloquial",
      "tone",
    ]);
    expect(TONE_OPTIONS).toHaveLength(4);
  });

  it("预设动作解析出固定指令", () => {
    const instruction = resolveInstruction({
      action: "polish",
      selected: "文本",
    });
    expect(instruction).toContain("保持原意和信息量不变");
  });

  it("换语气按所选语气拼指令", () => {
    expect(
      resolveInstruction({ action: "tone", tone: "sharp", selected: "文本" }),
    ).toContain("「犀利」");
  });

  it("换语气缺少语气时不可解析", () => {
    expect(resolveInstruction({ action: "tone", selected: "文本" })).toBeNull();
  });

  it("自定义指令过长时不可解析，避免整段正文被当成指令", () => {
    expect(
      resolveInstruction({
        action: "custom",
        instruction: "改".repeat(MAX_INSTRUCTION_CHARS + 1),
        selected: "文本",
      }),
    ).toBeNull();
  });

  it("自定义指令为空白时不可解析", () => {
    expect(
      resolveInstruction({
        action: "custom",
        instruction: "   ",
        selected: "文本",
      }),
    ).toBeNull();
    expect(
      resolveInstruction({
        action: "custom",
        instruction: "改成第二人称",
        selected: "文本",
      }),
    ).toBe("改成第二人称");
  });
});

describe("消息组装", () => {
  const base = {
    action: "polish" as const,
    selected: "待改写的片段",
    context: { before: "上一段", after: "下一段" },
  };

  it("顺序为上文、下文、片段、要求", () => {
    const messages = buildRewriteMessages(base);
    expect(messages).not.toBeNull();
    const user = messages![1].content;

    expect(messages![0].role).toBe("system");
    expect(user.indexOf("【上文】")).toBeLessThan(user.indexOf("【下文】"));
    expect(user.indexOf("【下文】")).toBeLessThan(
      user.indexOf("【需要改写的片段】"),
    );
    expect(user.indexOf("【需要改写的片段】")).toBeLessThan(
      user.indexOf("【要求】"),
    );
  });

  it("上下文标注为不要改写", () => {
    const user = buildRewriteMessages(base)![1].content;
    expect(user).toContain("仅供理解语境，不要改写");
  });

  it("没有上下文时不产出空的上下文段落", () => {
    const user = buildRewriteMessages({ ...base, context: undefined })![1]
      .content;
    expect(user).not.toContain("【上文】");
    expect(user).not.toContain("【下文】");
    expect(user).toContain("【需要改写的片段】");
  });

  it("只发送片段与前后文，不含全文之外的内容", () => {
    const user = buildRewriteMessages(base)![1].content;
    expect(user).toContain("待改写的片段");
    expect(user).toContain("上一段");
    expect(user).toContain("下一段");
  });

  it("片段为空或指令不可解析时返回 null，不发起请求", () => {
    expect(buildRewriteMessages({ ...base, selected: "   " })).toBeNull();
    expect(
      buildRewriteMessages({ action: "tone", selected: "文本" }),
    ).toBeNull();
  });
});

describe("输出清理", () => {
  it("剥掉整段包裹的代码围栏", () => {
    expect(sanitizeRewriteOutput("```\n改写结果\n```")).toBe("改写结果");
    expect(sanitizeRewriteOutput("```markdown\n改写结果\n```")).toBe(
      "改写结果",
    );
  });

  it("剥掉整段包裹的引号", () => {
    expect(sanitizeRewriteOutput('"改写结果"')).toBe("改写结果");
    expect(sanitizeRewriteOutput("“改写结果”")).toBe("改写结果");
  });

  it("正文本身含引号时不误剥", () => {
    const text = "他说“你好”，然后离开了";
    expect(sanitizeRewriteOutput(text)).toBe(text);
  });

  it("保留正文内部的代码块", () => {
    const text = "前面说明\n\n```js\nconst a = 1;\n```\n\n后面说明";
    expect(sanitizeRewriteOutput(text)).toBe(text);
  });

  it("保留块级 Markdown 标记", () => {
    expect(sanitizeRewriteOutput("## 改写后的标题")).toBe("## 改写后的标题");
    expect(sanitizeRewriteOutput("- 列表项")).toBe("- 列表项");
  });
});
