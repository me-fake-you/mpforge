import { render } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MarkdownPreview } from "../../components/Preview/MarkdownPreview";

// 预览的滚动同步 adapter 曾经挂在 html 依赖上，每敲一个字符都会销毁重建；
// 而注册 preview adapter 会触发一次 restoreAfterLayoutChange，
// 于是两个面板被反复强制滚动，表现为打字时编辑区和预览区一直往上跳。
let markdownValue = "初始内容";

vi.mock("../../store/editorStore", () => ({
  useEditorStore: () => ({ markdown: markdownValue }),
}));

const themeState = {
  themeId: "default",
  customCSS: "",
  customThemes: [],
  getThemeCSS: () => "",
  getAllThemes: () => [],
};

vi.mock("../../store/themeStore", () => ({
  useThemeStore: (selector?: (state: typeof themeState) => unknown) =>
    selector ? selector(themeState) : themeState,
}));

vi.mock("../../hooks/useUITheme", () => ({
  useUITheme: (selector: (state: { theme: string }) => unknown) =>
    selector({ theme: "light" }),
}));

vi.mock("../../utils/mermaidConfig", () => ({
  getMermaidConfig: () => ({}),
  getThemedMermaidDiagram: (input: string) => input,
}));

vi.mock("../../services/wechatTableRenderer", () => ({
  renderTableBlocksForPreview: vi.fn(async () => undefined),
}));

describe("打字时的预览滚动同步稳定性", () => {
  beforeEach(() => {
    const preferences = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => preferences.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        preferences.set(key, String(value));
      }),
    });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    markdownValue = "初始内容";
  });

  it("内容变化不重建滚动同步 adapter", () => {
    const onScrollSyncReady = vi.fn();
    const { rerender } = render(
      <MarkdownPreview onScrollSyncReady={onScrollSyncReady} />,
    );

    const callsAfterMount = onScrollSyncReady.mock.calls.length;
    expect(callsAfterMount).toBeGreaterThan(0);

    // 模拟连续打字：每次都换一份新内容
    for (let i = 1; i <= 12; i++) {
      markdownValue = `初始内容${"a".repeat(i)}`;
      rerender(<MarkdownPreview onScrollSyncReady={onScrollSyncReady} />);
    }

    // adapter 只应在挂载时注册一次，打字过程中不得反复注销/重注册
    expect(onScrollSyncReady.mock.calls.length).toBe(callsAfterMount);
  });

  it("挂载和卸载时报告真实滚动容器节点", () => {
    const onScrollContainerChange = vi.fn();
    const { container, unmount } = render(
      <MarkdownPreview onScrollContainerChange={onScrollContainerChange} />,
    );
    const scrollContainer = container.querySelector(".preview-container");

    expect(onScrollContainerChange).toHaveBeenCalledWith(scrollContainer);

    onScrollContainerChange.mockClear();
    unmount();
    expect(onScrollContainerChange).toHaveBeenCalledTimes(1);
    expect(onScrollContainerChange).toHaveBeenCalledWith(null);
  });
});
