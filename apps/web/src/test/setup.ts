import "@testing-library/jest-dom";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom 未实现 matchMedia:提供默认桌面环境的桩,避免查询指针类型时报错
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// jsdom 未实现 ResizeObserver:元素永不改变尺寸,空实现即可
if (typeof window !== "undefined" && !("ResizeObserver" in window)) {
  (window as unknown as Record<string, unknown>).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// 每次测试后清理 DOM
afterEach(() => {
  cleanup();
});
