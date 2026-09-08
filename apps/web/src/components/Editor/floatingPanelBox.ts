export interface FloatingPanelAnchor {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

export interface FloatingPanelBox {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
}

export interface FloatingPanelOptions {
  width: number;
  preferredMaxHeight: number;
  margin: number;
  gap: number;
}

export function computeFloatingPanelBox(
  anchor: FloatingPanelAnchor,
  viewport: { width: number; height: number },
  options: FloatingPanelOptions,
): FloatingPanelBox {
  const below = Math.max(
    0,
    viewport.height - anchor.bottom - options.gap - options.margin,
  );
  const above = Math.max(0, anchor.top - options.gap - options.margin);
  const openBelow = below >= options.preferredMaxHeight || below >= above;
  const selectedSpace = openBelow ? below : above;
  const width = Math.max(
    0,
    Math.min(options.width, viewport.width - 2 * options.margin),
  );
  const maxHeight = Math.min(options.preferredMaxHeight, selectedSpace);
  const minLeft = options.margin;
  const maxLeft = Math.max(minLeft, viewport.width - width - options.margin);
  const left = Math.min(maxLeft, Math.max(minLeft, anchor.right - width));
  const top = openBelow
    ? Math.min(
        anchor.bottom + options.gap,
        viewport.height - maxHeight - options.margin,
      )
    : Math.max(options.margin, anchor.top - options.gap - maxHeight);

  return { left, top, width, maxHeight };
}
