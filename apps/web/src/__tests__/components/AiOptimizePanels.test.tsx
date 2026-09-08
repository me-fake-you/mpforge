import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const mocked = vi.hoisted(() => ({
  streamChatCompletion: vi.fn(),
  requestOpenAiSettings: vi.fn(),
}));

vi.mock("../../services/ai/aiClient", async () => {
  const actual = await vi.importActual<
    typeof import("../../services/ai/aiClient")
  >("../../services/ai/aiClient");
  return { ...actual, streamChatCompletion: mocked.streamChatCompletion };
});

vi.mock("../../services/ai/aiConfig", async () => {
  const actual = await vi.importActual<
    typeof import("../../services/ai/aiConfig")
  >("../../services/ai/aiConfig");
  return { ...actual, requestOpenAiSettings: mocked.requestOpenAiSettings };
});

import { AiRequestError } from "../../services/ai/aiClient";
import { AiScorePanel } from "../../components/Editor/AiOptimize/AiScorePanel";
import { AiTitlePanel } from "../../components/Editor/AiOptimize/AiTitlePanel";
import { MAX_DOCUMENT_CHARS } from "../../services/ai/aiSelection";

const DOC = "# 欢迎使用 WeMD\n\n这是一个现代化的 Markdown 编辑器。";

const SCORE_OUTPUT = [
  "TOP|开头|这是一个现代化的 Markdown 编辑器|开头绕了三行才进入正题",
  "DIM|开头|一般|前 3 行|这是一个现代化的 Markdown 编辑器",
  "DIM|结构|好|9 个小标题|—",
  "FIX|开头|前两句是铺垫，读者不知道能得到什么|WeMD 让你直接写，排版自动跟上",
].join("\n");

const TITLE_OUTPUT = [
  "疑问|为什么你的排版总差一口气？",
  "直给|用 Markdown 写公众号",
  `数字|${"超".repeat(70)}`,
  "PICK|直给|读者要的是能上手的方法",
].join("\n");

function resolveWith(text: string) {
  mocked.streamChatCompletion.mockImplementation(
    async (options: { onDelta?: (d: string) => void }) => {
      act(() => options.onDelta?.(text));
      return text;
    },
  );
}

function editorActions() {
  return {
    reveal: vi.fn(() => true),
    applyFix: vi.fn(() => ({
      range: { from: 10, to: 24 },
      original: "编辑器里真实的那一段",
    })),
    revertFix: vi.fn(() => true),
  };
}

function stubStorage() {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, String(value)),
  });
}

describe("全文审阅面板", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubStorage();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("展示总评、维度行与建议", async () => {
    resolveWith(SCORE_OUTPUT);
    render(<AiScorePanel markdown={DOC} onClose={vi.fn()} onRerun={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByText("开头绕了三行才进入正题")).toBeInTheDocument(),
    );
    expect(screen.getByText("前 3 行")).toBeInTheDocument();
    expect(screen.getByText("9 个小标题")).toBeInTheDocument();
    expect(
      screen.getByText("前两句是铺垫，读者不知道能得到什么"),
    ).toBeInTheDocument();
  });

  it("档位为「好」时不显示引用，避免逼模型编引用", async () => {
    resolveWith(SCORE_OUTPUT);
    render(<AiScorePanel markdown={DOC} onClose={vi.fn()} onRerun={vi.fn()} />);

    await waitFor(() =>
      expect(document.querySelectorAll(".ai-score-quote")).toHaveLength(1),
    );
  });

  it("引用可点击并回传原文用于定位", async () => {
    resolveWith(SCORE_OUTPUT);
    const actions = editorActions();
    render(
      <AiScorePanel
        markdown={DOC}
        onClose={vi.fn()}
        editorActions={actions}
        onRerun={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(
        document.querySelector(".ai-score-quote.is-clickable"),
      ).not.toBeNull(),
    );
    fireEvent.click(document.querySelector(".ai-score-quote.is-clickable")!);
    expect(actions.reveal).toHaveBeenCalledWith(
      "这是一个现代化的 Markdown 编辑器",
    );
  });

  it("建议紧跟在它所属的维度行里，不堆在面板底部", async () => {
    resolveWith(SCORE_OUTPUT);
    render(<AiScorePanel markdown={DOC} onClose={vi.fn()} onRerun={vi.fn()} />);

    const advice =
      await screen.findByText("前两句是铺垫，读者不知道能得到什么");
    const row = advice.closest(".ai-score-row");
    expect(row!.querySelector(".ai-score-name")!.textContent).toBe("开头");
    const rows = [...document.querySelectorAll(".ai-score-row")];
    expect(rows.filter((r) => r.querySelector(".ai-fix"))).toHaveLength(1);
  });

  it("点引用先定位，展开后才出现采纳", async () => {
    resolveWith(SCORE_OUTPUT);
    const actions = editorActions();
    render(
      <AiScorePanel
        markdown={DOC}
        onClose={vi.fn()}
        editorActions={actions}
        onRerun={vi.fn()}
      />,
    );

    await screen.findByText("前两句是铺垫，读者不知道能得到什么");
    expect(screen.queryByRole("button", { name: "采纳" })).toBeNull();

    fireEvent.click(document.querySelector(".ai-score-quote.is-clickable")!);
    expect(actions.reveal).toHaveBeenCalledWith(
      "这是一个现代化的 Markdown 编辑器",
    );
    expect(
      screen.getByText("WeMD 让你直接写，排版自动跟上"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "采纳" })).toBeEnabled();
  });

  it("重新审阅整块重挂载，按当前正文重跑而不是重放旧文本", async () => {
    resolveWith(SCORE_OUTPUT);
    // 用一个和 AiScoreSidePanel 一样持有 key 的壳，验证真实的重跑路径
    function Host({ markdown }: { markdown: string }) {
      const [runId, setRunId] = useState(0);
      return (
        <AiScorePanel
          key={runId}
          markdown={markdown}
          onClose={vi.fn()}
          onRerun={() => setRunId((id) => id + 1)}
        />
      );
    }

    const { rerender } = render(<Host markdown={DOC} />);
    await screen.findByText("开头绕了三行才进入正题");

    const edited = DOC.replace(
      "这是一个现代化的 Markdown 编辑器。",
      "WeMD 让你直接写，排版自动跟上。",
    );
    rerender(<Host markdown={edited} />);
    fireEvent.click(screen.getByRole("button", { name: "重新审阅" }));

    const last = mocked.streamChatCompletion.mock.calls.at(-1)?.[0] as {
      messages: { content: string }[];
    };
    const sent = last.messages.at(-1)!.content;
    expect(sent).toContain("WeMD 让你直接写");
    expect(sent).not.toContain("这是一个现代化的 Markdown 编辑器。");
  });

  it("重挂载会清空采纳状态，不把上一轮的处置带到新结果上", async () => {
    resolveWith(SCORE_OUTPUT);
    const actions = editorActions();
    function Host() {
      const [runId, setRunId] = useState(0);
      return (
        <AiScorePanel
          key={runId}
          markdown={DOC}
          onClose={vi.fn()}
          editorActions={actions}
          onRerun={() => setRunId((id) => id + 1)}
        />
      );
    }

    render(<Host />);
    await screen.findByText("前两句是铺垫，读者不知道能得到什么");
    fireEvent.click(document.querySelector(".ai-score-quote.is-clickable")!);
    fireEvent.click(screen.getByRole("button", { name: "采纳" }));
    expect(screen.getByRole("button", { name: /撤销/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重新审阅" }));
    await screen.findByText("前两句是铺垫，读者不知道能得到什么");
    expect(screen.queryByRole("button", { name: /撤销/ })).toBeNull();
  });

  it("只有建议没有改写文本时不出现采纳按钮", async () => {
    resolveWith(
      [
        "DIM|结构|一般|4 个小标题|这是一个现代化的 Markdown 编辑器",
        "FIX|结构|并列的四点提成小标题|—",
      ].join("\n"),
    );
    const actions = editorActions();
    render(
      <AiScorePanel
        markdown={DOC}
        onClose={vi.fn()}
        editorActions={actions}
        onRerun={vi.fn()}
      />,
    );

    await screen.findByText("并列的四点提成小标题");
    fireEvent.click(document.querySelector(".ai-score-quote.is-clickable")!);

    expect(actions.reveal).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "采纳" })).toBeNull();
    expect(screen.queryByRole("button", { name: "不采纳" })).toBeNull();
  });

  it("采纳后写回正文并留下撤销", async () => {
    resolveWith(SCORE_OUTPUT);
    const actions = editorActions();
    render(
      <AiScorePanel
        markdown={DOC}
        onClose={vi.fn()}
        editorActions={actions}
        onRerun={vi.fn()}
      />,
    );

    await screen.findByText("前两句是铺垫，读者不知道能得到什么");
    fireEvent.click(document.querySelector(".ai-score-quote.is-clickable")!);
    fireEvent.click(screen.getByRole("button", { name: "采纳" }));

    expect(actions.applyFix).toHaveBeenCalledWith(
      "这是一个现代化的 Markdown 编辑器",
      "WeMD 让你直接写，排版自动跟上",
    );

    const undo = screen.getByRole("button", { name: /撤销/ });
    fireEvent.click(undo);
    // 撤销要把编辑器真正替换掉的那段原文还回去，而不是模型给的引用
    expect(actions.revertFix).toHaveBeenCalledWith(
      { from: 10, to: 24 },
      "WeMD 让你直接写，排版自动跟上",
      "编辑器里真实的那一段",
    );
  });

  it("撤销不掉时保持已采纳状态并说明，不假装撤销成功", async () => {
    resolveWith(SCORE_OUTPUT);
    const actions = editorActions();
    actions.revertFix.mockReturnValue(false);
    render(
      <AiScorePanel
        markdown={DOC}
        onClose={vi.fn()}
        editorActions={actions}
        onRerun={vi.fn()}
      />,
    );

    await screen.findByText("前两句是铺垫，读者不知道能得到什么");
    fireEvent.click(document.querySelector(".ai-score-quote.is-clickable")!);
    fireEvent.click(screen.getByRole("button", { name: "采纳" }));
    fireEvent.click(screen.getByRole("button", { name: /撤销/ }));

    expect(screen.getByText(/这段已被改动过，撤销不了/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /撤销/ })).toBeInTheDocument();
  });

  it("定位不到原文时不给采纳，如实说明而不是静默失败", async () => {
    resolveWith(SCORE_OUTPUT);
    const actions = editorActions();
    actions.reveal.mockReturnValue(false);
    render(
      <AiScorePanel
        markdown={DOC}
        onClose={vi.fn()}
        editorActions={actions}
        onRerun={vi.fn()}
      />,
    );

    await screen.findByText("前两句是铺垫，读者不知道能得到什么");
    fireEvent.click(document.querySelector(".ai-score-quote.is-clickable")!);

    expect(screen.getByRole("button", { name: "采纳" })).toBeDisabled();
    expect(screen.getByText(/未能在正文中定位到这段原文/)).toBeInTheDocument();
  });

  it("正文超限时明确告知截断，不静默丢弃", async () => {
    resolveWith(SCORE_OUTPUT);
    render(
      <AiScorePanel
        markdown={"字".repeat(MAX_DOCUMENT_CHARS + 100)}
        onClose={vi.fn()}
        onRerun={vi.fn()}
      />,
    );

    expect(screen.getByText(/仅评估前/)).toBeInTheDocument();
  });

  it("起标题时同样明确告知正文截断", async () => {
    resolveWith(TITLE_OUTPUT);
    render(
      <AiTitlePanel
        markdown={"字".repeat(MAX_DOCUMENT_CHARS + 100)}
        currentTitle="新文章"
        onClose={vi.fn()}
        onReplaceTitle={vi.fn()}
        onRerun={vi.fn()}
      />,
    );

    expect(screen.getByText(/仅依据前/)).toBeInTheDocument();
  });

  it("面板挂载即自动开跑，不需要手动点重新审阅", async () => {
    resolveWith(SCORE_OUTPUT);
    const { unmount } = render(
      <AiScorePanel markdown={DOC} onClose={vi.fn()} onRerun={vi.fn()} />,
    );

    await waitFor(() => expect(mocked.streamChatCompletion).toHaveBeenCalled());
    // 卸载会中止请求；重新挂载必须重新发起，不能被任何"只跑一次"的守卫拦住
    unmount();
    mocked.streamChatCompletion.mockClear();
    render(<AiScorePanel markdown={DOC} onClose={vi.fn()} onRerun={vi.fn()} />);
    await waitFor(() => expect(mocked.streamChatCompletion).toHaveBeenCalled());
  });

  it("尚无内容时不画分隔线，有内容后恢复", async () => {
    let emit: ((delta: string) => void) | undefined;
    mocked.streamChatCompletion.mockImplementation(
      (options: { onDelta?: (d: string) => void }) =>
        new Promise(() => {
          emit = options.onDelta;
        }),
    );
    render(<AiScorePanel markdown={DOC} onClose={vi.fn()} onRerun={vi.fn()} />);

    await waitFor(() => expect(emit).toBeDefined());
    expect(document.querySelector(".ai-panel-footer")).toHaveClass("is-bare");

    act(() =>
      emit!(
        "TOP|开头|这是一个现代化的 Markdown 编辑器|开头绕了三行\nDIM|开头|一般|前 3 行|这是一个现代化的 Markdown 编辑器\n",
      ),
    );
    await waitFor(() =>
      expect(document.querySelector(".ai-panel-footer")).not.toHaveClass(
        "is-bare",
      ),
    );
  });

  it("思考期间用现在时并计时，正文一来转为过去时", async () => {
    let emitReason: ((d: string) => void) | undefined;
    let emitContent: ((d: string) => void) | undefined;
    mocked.streamChatCompletion.mockImplementation(
      (options: {
        onDelta?: (d: string) => void;
        onReasoning?: (d: string) => void;
      }) =>
        new Promise(() => {
          emitReason = options.onReasoning;
          emitContent = options.onDelta;
        }),
    );
    render(<AiScorePanel markdown={DOC} onClose={vi.fn()} onRerun={vi.fn()} />);

    await waitFor(() => expect(emitReason).toBeDefined());
    act(() => emitReason!("先看开头"));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /正在思考/ }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText(/模型正在思考/)).toBeInTheDocument();

    act(() => emitContent!("TOP|开头|这是一个现代化的 Markdown 编辑器|结论\n"));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /思考了/ }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText(/正在通读全文/)).toBeInTheDocument();
  });

  it("没有思考内容时不显示思考记录", async () => {
    resolveWith(SCORE_OUTPUT);
    render(<AiScorePanel markdown={DOC} onClose={vi.fn()} onRerun={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByText("开头绕了三行才进入正题")).toBeInTheDocument(),
    );
    expect(document.querySelector(".thinking-trace")).toBeNull();
  });

  it("解析不出内容时如实说明并交还原始输出", async () => {
    resolveWith("好的，我觉得这篇文章整体还不错，建议再打磨一下开头。");
    render(<AiScorePanel markdown={DOC} onClose={vi.fn()} onRerun={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByText(/模型没有按预期格式返回/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/整体还不错/)).toBeInTheDocument();
  });

  it("完全没有输出时也给出明确说明，而不是空面板", async () => {
    resolveWith("");
    render(<AiScorePanel markdown={DOC} onClose={vi.fn()} onRerun={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByText("这次没有收到任何内容。")).toBeInTheDocument(),
    );
  });

  it("鉴权失败时给出检查设置入口", async () => {
    mocked.streamChatCompletion.mockRejectedValue(
      new AiRequestError("auth", "API Key 无效", 401),
    );
    render(<AiScorePanel markdown={DOC} onClose={vi.fn()} onRerun={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByText("API Key 无效")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /检查设置/ }));
    expect(mocked.requestOpenAiSettings).toHaveBeenCalled();
  });
});

describe("标题优化面板", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubStorage();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("推荐标记跟着 PICK 走，不是第一条", async () => {
    resolveWith(TITLE_OUTPUT);
    render(
      <AiTitlePanel
        markdown={DOC}
        currentTitle="WeMD 背景验证稿"
        onClose={vi.fn()}
        onReplaceTitle={vi.fn()}
        onRerun={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText("推荐")).toBeInTheDocument());
    const featured = document.querySelector(".ai-title-option.is-featured");
    expect(featured?.textContent).toContain("用 Markdown 写公众号");
    expect(screen.getByText(/读者要的是能上手的方法/)).toBeInTheDocument();
  });

  it("没有 PICK 时不标推荐", async () => {
    resolveWith("疑问|标题一\n直给|标题二");
    render(
      <AiTitlePanel
        markdown={DOC}
        currentTitle="WeMD 背景验证稿"
        onClose={vi.fn()}
        onReplaceTitle={vi.fn()}
        onRerun={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText("标题一")).toBeInTheDocument());
    expect(screen.queryByText("推荐")).not.toBeInTheDocument();
    expect(document.querySelector(".ai-title-option.is-featured")).toBeNull();
  });

  it("展示当前标题与候选", async () => {
    resolveWith(TITLE_OUTPUT);
    render(
      <AiTitlePanel
        markdown={DOC}
        currentTitle="WeMD 背景验证稿"
        onClose={vi.fn()}
        onReplaceTitle={vi.fn()}
        onRerun={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByText("为什么你的排版总差一口气？"),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("WeMD 背景验证稿")).toBeInTheDocument();
  });

  it("未选中时替换按钮禁用，选中后才可用", async () => {
    resolveWith(TITLE_OUTPUT);
    const onReplaceTitle = vi.fn();
    render(
      <AiTitlePanel
        markdown={DOC}
        currentTitle="WeMD 背景验证稿"
        onClose={vi.fn()}
        onReplaceTitle={onReplaceTitle}
        onRerun={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "替换标题" })).toBeDisabled(),
    );

    fireEvent.click(screen.getByText("为什么你的排版总差一口气？"));
    fireEvent.click(screen.getByRole("button", { name: "替换标题" }));
    expect(onReplaceTitle).toHaveBeenCalledWith("为什么你的排版总差一口气？");
  });

  it("超过 64 字的候选不可选中", async () => {
    resolveWith(TITLE_OUTPUT);
    render(
      <AiTitlePanel
        markdown={DOC}
        currentTitle="WeMD 背景验证稿"
        onClose={vi.fn()}
        onReplaceTitle={vi.fn()}
        onRerun={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(document.querySelectorAll(".ai-title-option")).toHaveLength(3),
    );
    const options = [...document.querySelectorAll(".ai-title-option")];
    expect((options[2] as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector(".ai-title-count.is-over")).not.toBeNull();
  });

  it("没有可验证数字时明确标为不适用且不可选择", async () => {
    resolveWith("数字|—\n直给|用 Markdown 写公众号");
    render(
      <AiTitlePanel
        markdown={DOC}
        currentTitle="WeMD 背景验证稿"
        onClose={vi.fn()}
        onReplaceTitle={vi.fn()}
        onRerun={vi.fn()}
      />,
    );

    const unavailable = await screen.findByText("本文无可验证数字");
    expect(unavailable.closest("button")).toBeDisabled();
  });

  it("候选解析不出来时展示原始输出", async () => {
    resolveWith("抱歉，我需要更多上下文才能拟标题。");
    render(
      <AiTitlePanel
        markdown={DOC}
        currentTitle="WeMD 背景验证稿"
        onClose={vi.fn()}
        onReplaceTitle={vi.fn()}
        onRerun={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText(/模型没有按预期格式返回/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/需要更多上下文/)).toBeInTheDocument();
  });

  it("新文章视为还没有标题，按钮改为「用作标题」", async () => {
    resolveWith(TITLE_OUTPUT);
    const onReplaceTitle = vi.fn();
    render(
      <AiTitlePanel
        markdown={"没有标题的正文"}
        currentTitle="新文章"
        onClose={vi.fn()}
        onReplaceTitle={onReplaceTitle}
        onRerun={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("还没有标题")).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "用作标题" }),
    ).toBeInTheDocument();
  });
});
