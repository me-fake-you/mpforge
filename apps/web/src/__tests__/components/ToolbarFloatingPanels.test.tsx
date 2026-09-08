import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("../../services/ai/aiConfig", () => ({
  isAiRewriteReady: () => true,
  subscribeAiConfig: () => () => {},
}));

vi.mock("../../components/Editor/AiOptimize/AiTitlePanel", () => ({
  AiTitlePanel: () => <div className="ai-panel">标题候选</div>,
}));

import {
  computeFloatingPanelBox,
  type FloatingPanelBox,
} from "../../components/Editor/floatingPanelBox";
import { Toolbar } from "../../components/Editor/Toolbar";
import { StorageProvider } from "../../storage/StorageContext";

const margin = 8;

function expectWithinViewport(
  box: FloatingPanelBox,
  viewport: { width: number; height: number },
) {
  expect(box.left).toBeGreaterThanOrEqual(margin);
  expect(box.top).toBeGreaterThanOrEqual(margin);
  expect(box.left + box.width).toBeLessThanOrEqual(viewport.width - margin);
  expect(box.top + box.maxHeight).toBeLessThanOrEqual(viewport.height - margin);
}

describe("工具栏浮层定位", () => {
  it("将右下角锚点的浮层夹回视口", () => {
    const viewport = { width: 1440, height: 900 };
    const box = computeFloatingPanelBox(
      { left: 1360, right: 1420, top: 780, bottom: 820 },
      viewport,
      { width: 380, preferredMaxHeight: 540, margin, gap: 4 },
    );

    expectWithinViewport(box, viewport);
  });

  it("在视口窄于目标浮层时收窄", () => {
    const viewport = { width: 340, height: 900 };
    const box = computeFloatingPanelBox(
      { left: 260, right: 300, top: 120, bottom: 150 },
      viewport,
      { width: 380, preferredMaxHeight: 540, margin, gap: 4 },
    );

    expect(box.width).toBe(324);
    expectWithinViewport(box, viewport);
  });

  it("在下方空间不足时向上展开", () => {
    const viewport = { width: 800, height: 600 };
    const box = computeFloatingPanelBox(
      { left: 680, right: 720, top: 500, bottom: 540 },
      viewport,
      { width: 220, preferredMaxHeight: 360, margin, gap: 4 },
    );

    expect(box.top + box.maxHeight).toBeLessThanOrEqual(496);

    expectWithinViewport(box, viewport);
  });
});
describe("紧凑工具栏浮层", () => {
  let clientWidthDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, String(value));
      },
    });
    clientWidthDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "clientWidth",
    );
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get: () => 340,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (clientWidthDescriptor) {
      Object.defineProperty(
        HTMLElement.prototype,
        "clientWidth",
        clientWidthDescriptor,
      );
    }
  });

  function openCompactMenu() {
    render(
      <StorageProvider>
        <Toolbar onInsert={vi.fn()} />
      </StorageProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "更多编辑工具" }));
  }

  function expectPortalStaysOpen(buttonName: string, panelText: string) {
    const dropdown = document.querySelector<HTMLElement>(
      ".toolbar-compact-dropdown",
    );
    expect(dropdown).toBeInTheDocument();
    fireEvent.click(
      within(dropdown!).getByRole("button", { name: buttonName }),
    );

    const panel = document.querySelector<HTMLElement>(
      "[data-toolbar-floating-panel]",
    );
    expect(panel).toHaveTextContent(panelText);
    expect(dropdown).not.toContainElement(panel);

    fireEvent.mouseDown(panel!);

    expect(
      screen.getByRole("button", { name: "更多编辑工具" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(panel).toBeInTheDocument();
  }

  it("在紧凑菜单内打开起标题浮层并保持交互", () => {
    openCompactMenu();

    expectPortalStaysOpen("起标题", "标题候选");
  });

  it("在紧凑菜单内打开语法帮助浮层并保持交互", () => {
    openCompactMenu();

    expectPortalStaysOpen("语法帮助", "Markdown 语法速查");
  });
});
