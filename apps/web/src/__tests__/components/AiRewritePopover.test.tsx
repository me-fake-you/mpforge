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
import { AiRewritePopover } from "../../components/Editor/AiRewrite/AiRewritePopover";

function renderPopover(
  overrides: Partial<{ onApply: () => void; onClose: () => void }> = {},
) {
  const onApply = vi.fn();
  const onClose = vi.fn();
  const onPreview = vi.fn<(text: string | null) => void>();
  render(
    <AiRewritePopover
      left={100}
      top={200}
      selected="原始片段"
      context={{ before: "上文", after: "下文" }}
      onApply={onApply}
      onClose={onClose}
      onPreview={onPreview}
      {...overrides}
    />,
  );
  return { onApply, onClose, onPreview };
}

describe("改写弹窗", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        values.set(key, String(value));
      }),
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("初始展示四个动作与自定义输入", () => {
    renderPopover();
    for (const label of ["润色", "精简", "口语化", "换语气"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByLabelText("自定义要求")).toBeInTheDocument();
  });

  it("换语气展开二级菜单", () => {
    renderPopover();
    fireEvent.click(screen.getByRole("button", { name: /换语气/ }));

    for (const tone of ["专业", "轻松", "亲切", "犀利"]) {
      expect(screen.getByRole("button", { name: tone })).toBeInTheDocument();
    }
  });

  it("流式过程中展示增量文本并可停止", async () => {
    let emit: ((delta: string) => void) | undefined;
    mocked.streamChatCompletion.mockImplementation(
      (options: { onDelta?: (d: string) => void }) =>
        new Promise(() => {
          emit = options.onDelta;
        }),
    );

    const { onPreview } = renderPopover();
    fireEvent.click(screen.getByRole("button", { name: "润色" }));

    await waitFor(() => expect(emit).toBeDefined());
    act(() => {
      emit!("改写");
      emit!("结果");
    });

    await waitFor(() => expect(onPreview).toHaveBeenLastCalledWith("改写结果"));
    expect(document.querySelector(".ai-result-text")).toBeNull();
    expect(screen.getByRole("button", { name: "停止" })).toBeInTheDocument();
    const loader = screen.getByRole("status");
    expect(loader).toHaveTextContent("正在改写");
    expect(loader).toHaveTextContent(/\d+\.\ds/);
    expect(
      screen.queryByRole("button", { name: "替换" }),
    ).not.toBeInTheDocument();
  });

  it("流式期间弹窗降为控制条，不再自己渲染结果", async () => {
    mocked.streamChatCompletion.mockImplementation(() => new Promise(() => {}));
    renderPopover();

    fireEvent.click(screen.getByRole("button", { name: "润色" }));
    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());

    expect(document.querySelector(".ai-result-text")).toBeNull();
    expect(document.querySelector(".ai-rewrite-popover")).toHaveClass("is-bar");
  });

  it("失败时清掉正文预览，不留残影", async () => {
    mocked.streamChatCompletion.mockRejectedValue(
      new AiRequestError("server", "模型服务暂时不可用", 503),
    );
    const { onPreview } = renderPopover();

    fireEvent.click(screen.getByRole("button", { name: "润色" }));
    await waitFor(() => expect(onPreview).toHaveBeenCalledWith(null));
  });

  it("完成后可替换，回传清理过的文本", async () => {
    mocked.streamChatCompletion.mockResolvedValue("```\n改写后的文字\n```");
    const { onApply, onPreview } = renderPopover();

    fireEvent.click(screen.getByRole("button", { name: "精简" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "替换" })).toBeEnabled(),
    );

    expect(onPreview).toHaveBeenLastCalledWith("改写后的文字");
    fireEvent.click(screen.getByRole("button", { name: "替换" }));
    expect(onApply).toHaveBeenCalledWith("改写后的文字");
  });

  it("空结果或原文回显时不提供替换，改为错误态", async () => {
    mocked.streamChatCompletion.mockResolvedValue("原始片段");
    renderPopover();

    fireEvent.click(screen.getByRole("button", { name: "润色" }));
    await waitFor(() =>
      expect(screen.getByText(/没有生成可用改写/)).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: "替换" }),
    ).not.toBeInTheDocument();
  });

  it("取消流式时回到动作菜单，不关闭弹窗", async () => {
    mocked.streamChatCompletion.mockRejectedValue(
      new AiRequestError("aborted", "已取消"),
    );
    const { onClose } = renderPopover();

    fireEvent.click(screen.getByRole("button", { name: "润色" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "润色" })).toBeInTheDocument(),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("鉴权失败时展示原因并给出检查设置入口", async () => {
    mocked.streamChatCompletion.mockRejectedValue(
      new AiRequestError("auth", "API Key 无效或没有权限", 401),
    );
    renderPopover();

    fireEvent.click(screen.getByRole("button", { name: "润色" }));
    await waitFor(() =>
      expect(screen.getByText(/API Key 无效/)).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /检查设置/ }));
    expect(mocked.requestOpenAiSettings).toHaveBeenCalled();
  });

  it("限流失败不给检查设置入口，只允许重试", async () => {
    mocked.streamChatCompletion.mockRejectedValue(
      new AiRequestError("rate_limit", "请求过于频繁", 429),
    );
    renderPopover();

    fireEvent.click(screen.getByRole("button", { name: "润色" }));
    await waitFor(() =>
      expect(screen.getByText(/请求过于频繁/)).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: /检查设置/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  });

  it("重试复用上一次的动作", async () => {
    mocked.streamChatCompletion.mockResolvedValue("第一次");
    renderPopover();

    fireEvent.click(screen.getByRole("button", { name: "口语化" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument(),
    );

    mocked.streamChatCompletion.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    await waitFor(() => expect(mocked.streamChatCompletion).toHaveBeenCalled());
    const messages = mocked.streamChatCompletion.mock.calls[0][0].messages;
    expect(messages[1].content).toContain("更像在对读者说话");
  });

  it("只把选中片段与前后文发给模型", async () => {
    mocked.streamChatCompletion.mockResolvedValue("结果");
    renderPopover();

    fireEvent.click(screen.getByRole("button", { name: "润色" }));
    await waitFor(() => expect(mocked.streamChatCompletion).toHaveBeenCalled());

    const user = mocked.streamChatCompletion.mock.calls[0][0].messages[1]
      .content as string;
    expect(user).toContain("原始片段");
    expect(user).toContain("上文");
    expect(user).toContain("下文");
  });

  it("Esc 关闭弹窗", () => {
    const { onClose } = renderPopover();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
