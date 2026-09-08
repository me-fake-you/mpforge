import type {
  BlankRegion,
  ContrastWarning,
  DarkTransparentImageRisk,
  ElementSnapshot,
  HeadingOverlap,
  LayoutDetection,
  LayoutSnapshot,
  OverflowElement,
  OversizedImageWarning,
  PreviewMode,
  RectSnapshot,
} from "./types.js";

const EDGE_TOLERANCE = 1;
const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_IMAGE_DIMENSION = 8_192;

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function parseColor(value: string): [number, number, number, number] | null {
  const match = value
    .trim()
    .match(
      /^rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i,
    );
  if (!match) return null;
  return [
    Math.min(255, Number(match[1])),
    Math.min(255, Number(match[2])),
    Math.min(255, Number(match[3])),
    match[4] === undefined ? 1 : Math.min(1, Number(match[4])),
  ];
}

function luminance([red, green, blue]: [
  number,
  number,
  number,
  number,
]): number {
  const linear = [red, green, blue].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(foreground: string, background: string): number | null {
  const foregroundColor = parseColor(foreground);
  const backgroundColor = parseColor(background);
  if (
    !foregroundColor ||
    !backgroundColor ||
    foregroundColor[3] === 0 ||
    backgroundColor[3] === 0
  ) {
    return null;
  }
  const first = luminance(foregroundColor);
  const second = luminance(backgroundColor);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function overlaps(first: RectSnapshot, second: RectSnapshot): number {
  const width = Math.max(
    0,
    Math.min(first.right, second.right) - Math.max(first.left, second.left),
  );
  const height = Math.max(
    0,
    Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top),
  );
  return Math.round(width * height);
}

function elementKind(element: ElementSnapshot): OverflowElement["kind"] {
  if (element.tag === "table") return "table";
  if (element.tag === "pre" || element.tag === "code") return "code";
  if (element.tag === "img") return "image";
  return "element";
}

function hasText(element: ElementSnapshot): boolean {
  return element.text.trim().length > 0;
}

function visibleGeometry(element: ElementSnapshot): boolean {
  return element.rect.width > 0 && element.rect.height > 0;
}

function overflowFor(
  element: ElementSnapshot,
  viewportWidth: number,
): OverflowElement | null {
  const viewportOverflow = Math.max(
    0,
    Math.ceil(element.rect.right - viewportWidth),
    Math.ceil(-element.rect.left),
  );
  if (viewportOverflow > EDGE_TOLERANCE) {
    return {
      selector: element.selector,
      kind: elementKind(element),
      reason: "viewport",
      overflow_pixels: viewportOverflow,
    };
  }
  const internalOverflow = Math.ceil(
    element.scroll_width - element.client_width,
  );
  if (internalOverflow > EDGE_TOLERANCE) {
    return {
      selector: element.selector,
      kind: elementKind(element),
      reason: "internal-scroll",
      overflow_pixels: internalOverflow,
    };
  }
  return null;
}

function detectBlankRegions(snapshot: LayoutSnapshot): BlankRegion[] {
  const threshold = Math.max(240, Math.round(snapshot.viewport.height * 0.65));
  const blocks = snapshot.elements
    .filter(
      (element) =>
        visibleGeometry(element) &&
        element.display !== "inline" &&
        element.position !== "fixed" &&
        element.position !== "sticky" &&
        element.rect.bottom >= 0,
    )
    .sort(
      (left, right) =>
        left.rect.top - right.rect.top ||
        left.selector.localeCompare(right.selector),
    );
  const regions: BlankRegion[] = [];
  let previous: ElementSnapshot | undefined;
  for (const element of blocks) {
    if (previous && element.parent_selector === previous.parent_selector) {
      const gap = Math.round(element.rect.top - previous.rect.bottom);
      if (gap > threshold) {
        regions.push({
          after_selector: previous.selector,
          before_selector: element.selector,
          gap_pixels: gap,
        });
      }
    }
    if (!previous || element.rect.bottom > previous.rect.bottom)
      previous = element;
  }
  return regions;
}

function detectOversizedImage(
  element: ElementSnapshot,
  viewportHeight: number,
): OversizedImageWarning | null {
  if (
    element.tag !== "img" ||
    !element.natural_width ||
    !element.natural_height
  )
    return null;
  const pixels = element.natural_width * element.natural_height;
  let reason: OversizedImageWarning["reason"] | null = null;
  if (pixels > MAX_IMAGE_PIXELS) reason = "pixel-count";
  else if (
    element.natural_width > MAX_IMAGE_DIMENSION ||
    element.natural_height > MAX_IMAGE_DIMENSION
  ) {
    reason = "dimensions";
  } else if (element.rect.height > viewportHeight * 4)
    reason = "rendered-height";
  return reason
    ? {
        selector: element.selector,
        natural_width: element.natural_width,
        natural_height: element.natural_height,
        rendered_height: Math.round(element.rect.height),
        reason,
      }
    : null;
}

function detectDarkImageRisk(
  element: ElementSnapshot,
  mode: PreviewMode,
): DarkTransparentImageRisk | null {
  if (mode !== "dark" || element.tag !== "img") return null;
  if (
    element.image_has_transparency &&
    element.image_average_luminance !== null &&
    element.image_average_luminance < 0.28
  ) {
    return {
      selector: element.selector,
      average_luminance: element.image_average_luminance,
      reason: "dark-content-on-transparency",
    };
  }
  if (
    element.image_analysis_error &&
    /security|taint|cross-origin/i.test(element.image_analysis_error)
  ) {
    return {
      selector: element.selector,
      average_luminance: null,
      reason: "transparency-uninspectable",
    };
  }
  return null;
}

export function detectLayoutIssues(
  snapshot: LayoutSnapshot,
  mode: PreviewMode,
): LayoutDetection {
  const overflowElements = snapshot.elements
    .map((element) => overflowFor(element, snapshot.viewport.width))
    .filter((value): value is OverflowElement => value !== null)
    .sort((left, right) => left.selector.localeCompare(right.selector));

  const contentClipped = snapshot.elements
    .filter(
      (element) =>
        (element.overflow_x === "hidden" ||
          element.overflow_x === "clip" ||
          element.overflow_y === "hidden" ||
          element.overflow_y === "clip") &&
        (element.scroll_width > element.client_width + EDGE_TOLERANCE ||
          element.scroll_height > element.client_height + EDGE_TOLERANCE),
    )
    .map((element) => {
      const horizontal =
        element.scroll_width > element.client_width + EDGE_TOLERANCE;
      const vertical =
        element.scroll_height > element.client_height + EDGE_TOLERANCE;
      return {
        selector: element.selector,
        axis:
          horizontal && vertical
            ? ("both" as const)
            : horizontal
              ? ("horizontal" as const)
              : ("vertical" as const),
        clipped_pixels: Math.max(
          element.scroll_width - element.client_width,
          element.scroll_height - element.client_height,
        ),
      };
    });

  const invisibleText = snapshot.elements.filter(hasText).flatMap((element) => {
    let reason:
      | "display"
      | "visibility"
      | "opacity"
      | "font-size"
      | "transparent-color"
      | null = null;
    if (element.display === "none") reason = "display";
    else if (
      element.visibility === "hidden" ||
      element.visibility === "collapse"
    )
      reason = "visibility";
    else if (element.opacity <= 0.01) reason = "opacity";
    else if (element.font_size <= 0.5) reason = "font-size";
    else if ((parseColor(element.color)?.[3] ?? 1) <= 0.01)
      reason = "transparent-color";
    return reason
      ? [
          {
            selector: element.selector,
            reason,
            excerpt: element.text.trim().slice(0, 120),
          },
        ]
      : [];
  });

  const headings = snapshot.elements.filter(
    (element) => /^h[1-6]$/.test(element.tag) && visibleGeometry(element),
  );
  const obstructions = snapshot.elements.filter(
    (element) =>
      visibleGeometry(element) &&
      (element.position === "fixed" ||
        element.position === "sticky" ||
        /^h[1-6]$/.test(element.tag)),
  );
  const headingOverlaps: HeadingOverlap[] = [];
  for (const heading of headings) {
    for (const obstruction of obstructions) {
      if (
        heading.selector === obstruction.selector ||
        heading.parent_selector === obstruction.selector ||
        obstruction.parent_selector === heading.selector
      ) {
        continue;
      }
      const overlapArea = overlaps(heading.rect, obstruction.rect);
      if (overlapArea > 4) {
        headingOverlaps.push({
          heading: heading.selector,
          obstructing_element: obstruction.selector,
          overlap_area: overlapArea,
        });
      }
    }
  }

  const contrastWarnings: ContrastWarning[] = snapshot.elements
    .filter(
      (element) =>
        hasText(element) && visibleGeometry(element) && element.opacity > 0.01,
    )
    .flatMap((element) => {
      const ratio = contrastRatio(element.color, element.background_color);
      const largeText =
        element.font_size >= 24 ||
        (element.font_size >= 18.66 && element.font_weight >= 700);
      const required = largeText ? 3 : 4.5;
      return ratio !== null && ratio < required
        ? [
            {
              selector: element.selector,
              foreground: element.color,
              background: element.background_color,
              ratio: Number(ratio.toFixed(2)),
              required_ratio: required,
            },
          ]
        : [];
    });

  const oversizedImages = snapshot.elements
    .map((element) => detectOversizedImage(element, snapshot.viewport.height))
    .filter((value): value is OversizedImageWarning => value !== null);
  const darkImageRisks = snapshot.elements
    .map((element) => detectDarkImageRisk(element, mode))
    .filter((value): value is DarkTransparentImageRisk => value !== null);
  const missingImages = uniqueSorted(
    snapshot.elements
      .filter(
        (element) =>
          element.tag === "img" &&
          (!element.image_complete || element.natural_width === 0),
      )
      .map((element) => element.selector),
  );

  return {
    horizontal_overflow:
      snapshot.document_scroll_width >
        snapshot.viewport.width + EDGE_TOLERANCE ||
      snapshot.body_scroll_width > snapshot.viewport.width + EDGE_TOLERANCE ||
      overflowElements.some((element) => element.reason === "viewport"),
    overflow_elements: overflowElements,
    table_overflow: uniqueSorted(
      overflowElements
        .filter((item) => item.kind === "table")
        .map((item) => item.selector),
    ),
    code_overflow: uniqueSorted(
      overflowElements
        .filter((item) => item.kind === "code")
        .map((item) => item.selector),
    ),
    image_overflow: uniqueSorted(
      overflowElements
        .filter((item) => item.kind === "image")
        .map((item) => item.selector),
    ),
    content_clipped: contentClipped,
    invisible_text: invisibleText,
    heading_overlaps: headingOverlaps.sort((left, right) =>
      left.heading.localeCompare(right.heading),
    ),
    contrast_warnings: contrastWarnings.sort((left, right) =>
      left.selector.localeCompare(right.selector),
    ),
    abnormal_blank_regions: detectBlankRegions(snapshot),
    oversized_images: oversizedImages,
    dark_transparent_image_risks: darkImageRisks,
    missing_images: missingImages,
  };
}
