import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";

const mocked = vi.hoisted(() => ({ streamChatCompletion: vi.fn() }));

vi.mock("../../services/ai/aiClient", async () => {
  const actual = await vi.importActual<
    typeof import("../../services/ai/aiClient")
  >("../../services/ai/aiClient");
  return { ...actual, streamChatCompletion: mocked.streamChatCompletion };
});

import { AiScoreSidePanel } from "../../components/Editor/AiOptimize/AiScoreSidePanel";
import { useAiPanelStore } from "../../store/aiPanelStore";
import { useEditorStore } from "../../store/editorStore";

const REPORT = [
  "TOP|开头|这是一个现代化的编辑器|开头绕了三行",
  "DIM|开头|待改进|前 3 行|这是一个现代化的编辑器",
].join("\n");

describe("全文审阅侧栏", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, String(value)),
    });
    useAiPanelStore.setState({ scorePanelOpen: true, editorActions: null });
    useEditorStore.setState({ markdown: "这是一个现代化的编辑器" });
    mocked.streamChatCompletion.mockImplementation(
      async (options: { onDelta?: (d: string) => void }) => {
        act(() => options.onDelta?.(REPORT));
        return REPORT;
      },
    );
  });

  it("侧栏形态不使用浮层样式，交给外层容器排版", async () => {
    render(<AiScoreSidePanel />);
    await waitFor(() =>
      expect(screen.getByText("开头绕了三行")).toBeInTheDocument(),
    );
    expect(document.querySelector(".ai-panel")).toHaveClass("is-side");
  });

  it("关闭按钮收起侧栏", async () => {
    render(<AiScoreSidePanel />);
    await waitFor(() =>
      expect(screen.getByLabelText("关闭全文审阅")).toBeInTheDocument(),
    );

    act(() => screen.getByLabelText("关闭全文审阅").click());
    expect(useAiPanelStore.getState().scorePanelOpen).toBe(false);
  });

  it("侧栏内不再重复给关闭按钮，头部已有一个", async () => {
    render(<AiScoreSidePanel />);
    await waitFor(() =>
      expect(screen.getByText("开头绕了三行")).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: "关闭" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "重新审阅" }),
    ).toBeInTheDocument();
  });

  it("退场与隐藏由外层分别控制，播完才让出网格列", async () => {
    const { rerender } = render(<AiScoreSidePanel />);
    await waitFor(() =>
      expect(screen.getByText("开头绕了三行")).toBeInTheDocument(),
    );

    rerender(<AiScoreSidePanel closing />);
    const aside = () => document.querySelector(".ai-score-side");
    expect(aside()).toHaveClass("is-closing");
    expect(aside()).not.toHaveAttribute("hidden");

    rerender(<AiScoreSidePanel hidden />);
    expect(aside()).toHaveAttribute("hidden");
    expect(screen.getByText("开头绕了三行")).toBeInTheDocument();
  });

  it("隐藏再显示不会重新发起评分", async () => {
    const { rerender } = render(<AiScoreSidePanel />);
    await waitFor(() => expect(mocked.streamChatCompletion).toHaveBeenCalled());
    const calls = mocked.streamChatCompletion.mock.calls.length;

    rerender(<AiScoreSidePanel hidden />);
    rerender(<AiScoreSidePanel />);

    expect(mocked.streamChatCompletion).toHaveBeenCalledTimes(calls);
    expect(screen.getByText("开头绕了三行")).toBeInTheDocument();
  });

  it("接入编辑器注册的定位函数，引用可点击", async () => {
    const reveal = vi.fn(() => true);
    useAiPanelStore.setState({
      editorActions: { reveal, applyFix: vi.fn(), revertFix: vi.fn() },
    });
    render(<AiScoreSidePanel />);

    await waitFor(() =>
      expect(
        document.querySelector(".ai-score-quote.is-clickable"),
      ).not.toBeNull(),
    );
    act(() =>
      (
        document.querySelector(".ai-score-quote.is-clickable") as HTMLElement
      ).click(),
    );
    expect(reveal).toHaveBeenCalledWith("这是一个现代化的编辑器");
  });
});
