import { describe, expect, it, vi } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

import {
  computeAnchor,
  createAnchorReporter,
  type AiRewriteHandlers,
  type RewriteAnchor,
} from "../../components/Editor/AiRewrite/aiRewriteExtension";

const DOC = ["第一段第一行", "第一段第二行", "", "```js", "code", "```"].join(
  "\n",
);

interface MockOptions {
  doc?: string;
  from?: number;
  to?: number;
  coords?: { left: number; right: number; top: number; bottom: number } | null;
  scrollRect?: { top: number; bottom: number };
  dispatch?: ReturnType<typeof vi.fn>;
}

function createMockView(options: MockOptions = {}): EditorView {
  const {
    doc = DOC,
    from = 0,
    to = 0,
    coords = { left: 100, right: 140, top: 50, bottom: 68 },
    scrollRect = { top: 0, bottom: 600 },
    dispatch = vi.fn(),
  } = options;

  const state = EditorState.create({
    doc,
    selection: EditorSelection.create([EditorSelection.range(from, to)]),
  });

  return {
    state,
    dispatch,
    coordsAtPos: () => coords,
    scrollDOM: { getBoundingClientRect: () => scrollRect },
  } as unknown as EditorView;
}

function createHandlers(enabled = true) {
  return {
    onAnchorChange: vi.fn<(anchor: RewriteAnchor | null) => void>(),
    isEnabled: () => enabled,
  } satisfies AiRewriteHandlers;
}

describe("浮标定位", () => {
  it("有效选区返回选区末端坐标", () => {
    const anchor = computeAnchor(createMockView({ from: 0, to: 6 }));
    expect(anchor).toEqual({ from: 0, to: 6, left: 100, top: 50 });
  });

  it("空选区不产生浮标", () => {
    expect(computeAnchor(createMockView({ from: 3, to: 3 }))).toBeNull();
  });

  it("过短选区不产生浮标", () => {
    expect(computeAnchor(createMockView({ from: 0, to: 2 }))).toBeNull();
  });

  it("代码块内的选区不产生浮标", () => {
    const start = DOC.indexOf("code");
    expect(
      computeAnchor(createMockView({ from: start, to: start + 4 })),
    ).toBeNull();
  });

  it("选区滚出可视区时收起浮标", () => {
    const above = createMockView({
      from: 0,
      to: 6,
      coords: { left: 10, right: 40, top: -80, bottom: -62 },
    });
    expect(computeAnchor(above)).toBeNull();

    const below = createMockView({
      from: 0,
      to: 6,
      coords: { left: 10, right: 40, top: 900, bottom: 918 },
    });
    expect(computeAnchor(below)).toBeNull();
  });

  it("拿不到坐标时不产生浮标", () => {
    expect(
      computeAnchor(createMockView({ from: 0, to: 6, coords: null })),
    ).toBeNull();
  });
});

describe("浮标上报", () => {
  it("同一位置重复上报只通知一次", () => {
    const handlers = createHandlers();
    const reporter = createAnchorReporter(handlers);
    const view = createMockView({ from: 0, to: 6 });

    reporter.report(view);
    reporter.report(view);
    expect(handlers.onAnchorChange).toHaveBeenCalledTimes(1);
  });

  it("从有效选区回到空选区时上报 null", () => {
    const handlers = createHandlers();
    const reporter = createAnchorReporter(handlers);

    reporter.report(createMockView({ from: 0, to: 6 }));
    reporter.report(createMockView({ from: 3, to: 3 }));

    expect(handlers.onAnchorChange).toHaveBeenLastCalledWith(null);
  });

  it("未启用时不产生浮标", () => {
    const handlers = createHandlers(false);
    const reporter = createAnchorReporter(handlers);

    reporter.report(createMockView({ from: 0, to: 6 }));
    expect(handlers.onAnchorChange).not.toHaveBeenCalled();
  });

  it("hide 收起当前浮标，且不重复上报 null", () => {
    const handlers = createHandlers();
    const reporter = createAnchorReporter(handlers);

    reporter.report(createMockView({ from: 0, to: 6 }));
    reporter.hide();
    reporter.hide();

    expect(handlers.onAnchorChange).toHaveBeenCalledTimes(2);
    expect(handlers.onAnchorChange).toHaveBeenLastCalledWith(null);
  });
});
