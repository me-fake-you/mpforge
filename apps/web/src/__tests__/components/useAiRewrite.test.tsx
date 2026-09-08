import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { EditorSelection, EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

const mocked = vi.hoisted(() => ({
  isMobile: false,
  toastError: vi.fn(),
}));

vi.mock("react-hot-toast", () => ({
  default: { error: mocked.toastError, success: vi.fn() },
}));

vi.mock("../../hooks/useMobileView", () => ({
  useMobileView: () => ({ isMobile: mocked.isMobile }),
}));

import { useAiRewrite } from "../../components/Editor/AiRewrite/useAiRewrite";
import { setRewritePreview } from "../../components/Editor/AiRewrite/aiPreviewWidget";
import { setAiConfig, type AiConfig } from "../../services/ai/aiConfig";

const DOC = "第一段内容\n\n第二段内容";

const READY_CONFIG: AiConfig = {
  enabled: true,
  provider: "deepseek",
  baseUrl: "https://api.deepseek.com/v1",
  apiKey: "sk-test",
  model: "deepseek-chat",
  preference: "",
};

function createViewRef(doc = DOC) {
  const dispatch = vi.fn();
  const view = {
    state: EditorState.create({
      doc,
      selection: EditorSelection.create([EditorSelection.cursor(0)]),
    }),
    dispatch,
    focus: vi.fn(),
    coordsAtPos: () => ({ left: 10, right: 20, top: 30, bottom: 44 }),
    scrollDOM: { getBoundingClientRect: () => ({ top: 0, bottom: 600 }) },
  } as unknown as EditorView;

  return { ref: { current: view }, dispatch, view };
}

describe("useAiRewrite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.isMobile = false;
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        values.set(key, String(value));
      }),
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("未配置时不就绪", () => {
    const { ref } = createViewRef();
    const { result } = renderHook(() => useAiRewrite(ref));
    expect(result.current.ready).toBe(false);
  });

  it("配置就绪后随事件更新为可用", () => {
    const { ref } = createViewRef();
    const { result } = renderHook(() => useAiRewrite(ref));

    act(() => setAiConfig(READY_CONFIG));
    expect(result.current.ready).toBe(true);
  });

  it("移动端即便配置完整也不启用", () => {
    mocked.isMobile = true;
    const { ref } = createViewRef();
    const { result } = renderHook(() => useAiRewrite(ref));

    act(() => setAiConfig(READY_CONFIG));
    expect(result.current.ready).toBe(false);
  });

  it("替换写回编辑器并把光标留在新文本末尾", () => {
    const { ref, dispatch } = createViewRef();
    const { result } = renderHook(() => useAiRewrite(ref));

    act(() => setAiConfig(READY_CONFIG));
    act(() => result.current.openAt(0, 5));
    act(() => result.current.apply("改写后的内容"));

    expect(dispatch).toHaveBeenCalledWith({
      changes: { from: 0, to: 5, insert: "改写后的内容" },
      selection: { anchor: 6 },
    });
  });

  it("预览派发到编辑器，锚定在选区末端", () => {
    const { ref, dispatch } = createViewRef();
    const { result } = renderHook(() => useAiRewrite(ref));

    act(() => setAiConfig(READY_CONFIG));
    act(() => result.current.openAt(0, 5));
    act(() => result.current.preview("改写中的文字"));

    const effects = dispatch.mock.calls.at(-1)?.[0].effects;
    expect(effects.is(setRewritePreview)).toBe(true);
    expect(effects.value).toEqual({ to: 5, text: "改写中的文字" });
  });

  it("关闭时清掉预览，文档不留残影", () => {
    const { ref, dispatch } = createViewRef();
    const { result } = renderHook(() => useAiRewrite(ref));

    act(() => setAiConfig(READY_CONFIG));
    act(() => result.current.openAt(0, 5));
    act(() => result.current.preview("改写中的文字"));
    dispatch.mockClear();
    act(() => result.current.close());

    const effects = dispatch.mock.calls.at(-1)?.[0].effects;
    expect(effects.is(setRewritePreview)).toBe(true);
    expect(effects.value).toBeNull();
  });

  it("流式期间原文被改动时拒绝替换", () => {
    const { ref, dispatch } = createViewRef();
    const { result } = renderHook(() => useAiRewrite(ref));

    act(() => setAiConfig(READY_CONFIG));
    act(() => result.current.openAt(0, 5));

    ref.current = {
      ...ref.current,
      state: EditorState.create({ doc: "完全不同的文字\n\n第二段内容" }),
    } as unknown as EditorView;

    act(() => result.current.apply("改写后的内容"));

    const changed = dispatch.mock.calls.some((call) => "changes" in call[0]);
    expect(changed).toBe(false);
    expect(mocked.toastError).toHaveBeenCalledWith(
      expect.stringContaining("原文已改动"),
    );
  });
});
