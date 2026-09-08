import { describe, expect, it } from "vitest";

import { computeDropdownBox } from "../../components/Settings/dropdownBox";

const vp = { width: 1280, height: 800 };
const anchor = (over: Partial<Parameters<typeof computeDropdownBox>[0]> = {}) =>
  ({ left: 400, top: 300, bottom: 340, width: 500, ...over }) as Parameters<
    typeof computeDropdownBox
  >[0];

const inside = (box: ReturnType<typeof computeDropdownBox>, viewport = vp) => {
  const top =
    box.top !== undefined
      ? box.top
      : viewport.height - (box.bottom ?? 0) - box.maxHeight;
  return (
    box.left >= 0 &&
    box.left + box.width <= viewport.width &&
    top >= 0 &&
    top + box.maxHeight <= viewport.height
  );
};

describe("模型下拉定位", () => {
  it("空间充足时贴着输入框下方展开", () => {
    const box = computeDropdownBox(anchor(), vp);
    expect(box.bottom).toBeUndefined();
    expect(box.left).toBe(400);
    expect(box.top).toBe(344);
    expect(box.maxHeight).toBe(240);
  });

  it("下方放不下且上方更宽裕时翻到上面", () => {
    const box = computeDropdownBox(anchor({ top: 700, bottom: 740 }), vp);
    expect(box.top).toBeUndefined();
    expect(box.bottom).toBeDefined();
    expect(inside(box)).toBe(true);
  });

  it("上下都放不下时不硬撑固定高度，结果仍在视口内", () => {
    const short = { width: 1280, height: 200 };
    const box = computeDropdownBox(anchor({ top: 42, bottom: 148 }), short);
    expect(inside(box, short)).toBe(true);
  });

  it("锚点贴着窗口底边时结果仍完全在视口内", () => {
    const box = computeDropdownBox(anchor({ top: 760, bottom: 798 }), vp);
    expect(inside(box)).toBe(true);
  });

  it("锚点贴着右边或伸出窗口时左移夹回视口", () => {
    const box = computeDropdownBox(anchor({ left: 1100, width: 500 }), vp);
    expect(box.left + box.width).toBeLessThanOrEqual(vp.width);
    expect(box.left).toBeGreaterThanOrEqual(0);
  });

  it("锚点在负坐标上也不会把下拉推出左边界", () => {
    const box = computeDropdownBox(anchor({ left: -200 }), vp);
    expect(box.left).toBeGreaterThanOrEqual(0);
  });

  it("锚点还没布局（rect 全 0）时给出可用宽度，不塌成一条线", () => {
    const box = computeDropdownBox(
      { left: 0, top: 0, bottom: 0, width: 0 },
      vp,
    );
    expect(box.width).toBeGreaterThanOrEqual(220);
    expect(inside(box)).toBe(true);
  });

  it("窗口极窄时宽度超出也从左边距起算，不出现负偏移", () => {
    const narrow = { width: 320, height: 800 };
    const box = computeDropdownBox(anchor({ left: 10, width: 500 }), narrow);
    expect(box.left).toBeGreaterThanOrEqual(0);
  });
});
