export interface AnchorRect {
  left: number;
  top: number;
  bottom: number;
  width: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface DropdownBox {
  left: number;
  width: number;
  maxHeight: number;
  /** 向上展开时给 bottom，向下展开时给 top，调用方直接摊进 style */
  top?: number;
  bottom?: number;
}

const GAP = 4;
const MARGIN = 8;
/** 约 6 条：再多在视觉上压过表单本身 */
const PREFERRED = 240;
const MIN_HEIGHT = 80;
/** 锚点还没布局时 rect 全是 0，兜一个可用宽度，别塌成一条线 */
const MIN_WIDTH = 220;

/**
 * 算出挂在 body 上的下拉框位置。
 * 结果始终夹在视口内：宁可盖住锚点，也不能跑到窗口外让用户看不见。
 */
export function computeDropdownBox(
  anchor: AnchorRect,
  viewport: Viewport,
): DropdownBox {
  const below = viewport.height - anchor.bottom - GAP - MARGIN;
  const above = anchor.top - GAP - MARGIN;
  // 下方放得下就下拉，放不下再看上方是否更宽裕
  const flipped = below < Math.min(PREFERRED, above);
  // 只用真正有的空间；硬撑到固定高度会直接顶出窗口
  const maxHeight = Math.max(
    MIN_HEIGHT,
    Math.min(PREFERRED, flipped ? above : below),
  );

  const fit = (start: number) =>
    Math.max(MARGIN, Math.min(start, viewport.height - maxHeight - MARGIN));

  const width = Math.max(MIN_WIDTH, anchor.width);

  return {
    left: Math.max(
      MARGIN,
      Math.min(anchor.left, viewport.width - width - MARGIN),
    ),
    width,
    maxHeight,
    ...(flipped
      ? { bottom: fit(viewport.height - anchor.top + GAP) }
      : { top: fit(anchor.bottom + GAP) }),
  };
}
