import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorPreviewWorkspace } from "../../components/Workspace/EditorPreviewWorkspace";

vi.mock("../../components/Editor/MarkdownEditor", () => ({
  MarkdownEditor: () => <div>编辑器</div>,
}));

const { markdownPreviewPropsMock } = vi.hoisted(() => ({
  markdownPreviewPropsMock: vi.fn(),
}));

vi.mock("../../components/Preview/MarkdownPreview", () => ({
  MarkdownPreview: (props: unknown) => {
    markdownPreviewPropsMock(props);
    return <div>预览区</div>;
  },
}));

describe("编辑器与预览工作区", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => store.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store.set(key, String(value));
      }),
    });
    markdownPreviewPropsMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("向预览组件传递滚动容器注册回调", () => {
    render(<EditorPreviewWorkspace loading={false} />);

    expect(markdownPreviewPropsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        onScrollContainerChange: expect.any(Function),
      }),
    );
  });

  it("默认提供可调分隔条并持久化键盘调整后的像素宽度", async () => {
    render(<EditorPreviewWorkspace loading={false} />);

    const separator = screen.getByRole("separator", {
      name: "调整编辑器与预览宽度",
    });
    expect(screen.getByText("编辑器")).toBeInTheDocument();
    expect(screen.getByText("预览区")).toBeInTheDocument();

    fireEvent.keyDown(separator, { key: "ArrowLeft" });

    await waitFor(() => {
      const stored = Number(localStorage.getItem("wemd-editor-pane-width"));
      expect(Number.isFinite(stored)).toBe(true);
      expect(stored).toBeGreaterThanOrEqual(340);
    });
  });

  it("移动布局不挂载分隔条或写入桌面分栏偏好", () => {
    render(<EditorPreviewWorkspace loading={false} mobileView="editor" />);

    expect(
      screen.queryByRole("separator", { name: "调整编辑器与预览宽度" }),
    ).not.toBeInTheDocument();
    expect(localStorage.setItem).not.toHaveBeenCalled();
  });
});
