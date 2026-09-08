import { renderHook, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMobileView } from "../../hooks/useMobileView";

const originalInnerWidth = window.innerWidth;

// 设定视口宽度与主指针类型（粗指针=真实触屏），需在 renderHook 前调用
const setViewport = (innerWidth: number, coarsePointer: boolean) => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: innerWidth,
  });
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes("coarse") ? coarsePointer : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  })) as unknown as typeof window.matchMedia;
};

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: originalInnerWidth,
  });
});

describe("useMobileView", () => {
  it("粗指针（真实触屏）+ 窄屏视为移动端", () => {
    setViewport(500, true);
    const { result } = renderHook(() => useMobileView());
    expect(result.current.isMobile).toBe(true);
  });

  it("细指针（桌面浏览器）即使窗口拖得很窄也保持桌面布局", () => {
    setViewport(500, false);
    const { result } = renderHook(() => useMobileView());
    expect(result.current.isMobile).toBe(false);
  });

  it("1440px 代表性宽屏即便是触屏也视为桌面布局", () => {
    setViewport(1440, true);
    const { result } = renderHook(() => useMobileView());
    expect(result.current.isMobile).toBe(false);
  });

  it("从移动尺寸放大到桌面时重置为编辑视图", () => {
    setViewport(500, true);
    const { result } = renderHook(() => useMobileView());
    expect(result.current.isMobile).toBe(true);

    act(() => result.current.setActiveView("preview"));
    expect(result.current.activeView).toBe("preview");

    act(() => {
      setViewport(1200, true);
      window.dispatchEvent(new Event("resize"));
    });
    expect(result.current.isMobile).toBe(false);
    expect(result.current.activeView).toBe("editor");
  });
});
