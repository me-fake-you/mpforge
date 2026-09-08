import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const STORAGE_KEY = "wemd-editor-pane-width";
const LEGACY_RATIO_KEY = "wemd-editor-pane-ratio";
// 首次没有像素记录时,按容器宽度换算一次的初始占比
const DEFAULT_RATIO = 0.58;
const DIVIDER_WIDTH = 16;
const MIN_EDITOR_WIDTH = 340;
const PREVIEW_CANVAS_WIDTH = 402;
// 首帧回退值；挂载后按浏览器实际 gutter 与面板边框动态更新
export const DEFAULT_MIN_PREVIEW_WIDTH = 416;
const DEFAULT_DESKTOP_APP_MIN_WIDTH = 1080;
// 键盘微调步长(像素),Shift 加速
const KEYBOARD_STEP = 16;
const KEYBOARD_STEP_LARGE = 64;

interface UseSplitPaneOptions {
  enabled?: boolean;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

// 无有效像素值时返回 null,交由首帧按容器宽度换算
const loadStoredWidth = (): number | null => {
  try {
    const px = Number(window.localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(px) && px > 0 ? px : null;
  } catch {
    return null;
  }
};

// 兼容旧的比例持久化:仅在没有像素记录时用于首帧换算
const loadLegacyRatio = (): number => {
  try {
    const ratio = Number(window.localStorage.getItem(LEGACY_RATIO_KEY));
    return Number.isFinite(ratio) && ratio > 0 && ratio < 1
      ? ratio
      : DEFAULT_RATIO;
  } catch {
    return DEFAULT_RATIO;
  }
};

// 编辑器固定像素:下限保证可写作,上限保证预览完整容纳固定画布
export const getEditorWidthBounds = (
  containerWidth: number,
  minPreviewWidth = DEFAULT_MIN_PREVIEW_WIDTH,
) => {
  const availableWidth = Math.max(1, containerWidth - DIVIDER_WIDTH);
  const max = Math.max(MIN_EDITOR_WIDTH, availableWidth - minPreviewWidth);
  return { min: MIN_EDITOR_WIDTH, max, availableWidth };
};

export const getDesktopAppMinWidth = (minPreviewWidth: number): number =>
  DEFAULT_DESKTOP_APP_MIN_WIDTH +
  Math.max(0, minPreviewWidth - DEFAULT_MIN_PREVIEW_WIDTH);

export function useSplitPane({ enabled = true }: UseSplitPaneOptions = {}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [previewPaneElement, setPreviewPaneElement] =
    useState<HTMLDivElement | null>(null);
  const [previewContainerElement, setPreviewContainerElement] =
    useState<HTMLDivElement | null>(null);
  const [minPreviewWidth, setMinPreviewWidth] = useState(
    DEFAULT_MIN_PREVIEW_WIDTH,
  );
  const [preferredWidth, setPreferredWidth] = useState<number | null>(() =>
    enabled ? loadStoredWidth() : null,
  );
  const [containerWidth, setContainerWidth] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [preferenceReady, setPreferenceReady] = useState(enabled);
  // 旧比例只读一次,作为首帧显示与迁移换算的统一基线,避免首帧先按下限再跳变
  const legacyRatioRef = useRef(enabled ? loadLegacyRatio() : DEFAULT_RATIO);

  useEffect(() => {
    if (!enabled || preferenceReady) return;
    legacyRatioRef.current = loadLegacyRatio();
    setPreferredWidth(loadStoredWidth());
    setPreferenceReady(true);
  }, [enabled, preferenceReady]);

  useLayoutEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    const updateLayoutMetrics = () => {
      if (container) setContainerWidth(container.clientWidth);
      if (!previewPaneElement || !previewContainerElement) return;
      const paneChrome = Math.max(
        0,
        previewPaneElement.offsetWidth - previewPaneElement.clientWidth,
      );
      const scrollbarGutter = Math.max(
        0,
        previewContainerElement.offsetWidth -
          previewContainerElement.clientWidth,
      );
      setMinPreviewWidth(
        Math.max(
          DEFAULT_MIN_PREVIEW_WIDTH,
          PREVIEW_CANVAS_WIDTH + paneChrome + scrollbarGutter,
        ),
      );
    };
    updateLayoutMetrics();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateLayoutMetrics);
      return () => window.removeEventListener("resize", updateLayoutMetrics);
    }

    const observer = new ResizeObserver(updateLayoutMetrics);
    if (container) observer.observe(container);
    if (previewPaneElement) observer.observe(previewPaneElement);
    if (previewContainerElement) observer.observe(previewContainerElement);
    return () => observer.disconnect();
  }, [enabled, previewContainerElement, previewPaneElement]);

  const bounds = useMemo(
    () => getEditorWidthBounds(containerWidth || 1200, minPreviewWidth),
    [containerWidth, minPreviewWidth],
  );

  // 首次或旧比例迁移:没有像素偏好且容器已量出时,按比例换算成像素并固化
  useEffect(() => {
    if (!enabled || !preferenceReady) return;
    if (preferredWidth != null) return;
    if (!containerWidth) return;
    const initial = legacyRatioRef.current * bounds.availableWidth;
    setPreferredWidth(clamp(initial, bounds.min, bounds.max));
    try {
      window.localStorage.removeItem(LEGACY_RATIO_KEY);
    } catch {
      /* 忽略清理错误 */
    }
  }, [
    preferredWidth,
    containerWidth,
    bounds.availableWidth,
    bounds.min,
    bounds.max,
    enabled,
    preferenceReady,
  ]);

  useEffect(() => {
    if (!enabled) return;
    if (preferredWidth == null) return;
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        String(Math.round(preferredWidth)),
      );
    } catch {
      /* 忽略持久化错误 */
    }
  }, [enabled, preferredWidth]);

  // 拖外层窗口时编辑器像素宽度保持不变,仅在窗口过窄时被上限夹回以保证预览画布;
  // 保存的偏好宽度不随窗口收缩而丢失,放大窗口后自动恢复。
  // 迁移前(preferredWidth 尚为 null)首帧按同一旧比例换算,避免先渲染成最小宽度再跳变
  const editorWidth = clamp(
    preferredWidth ?? legacyRatioRef.current * bounds.availableWidth,
    bounds.min,
    bounds.max,
  );

  const setWidth = useCallback(
    (nextWidth: number) => {
      if (!enabled) return;
      // 仅约束在容器可用范围内保存用户意图,显示时再按当前窗口夹取
      setPreferredWidth(
        clamp(nextWidth, MIN_EDITOR_WIDTH, bounds.availableWidth),
      );
    },
    [bounds.availableWidth, enabled],
  );

  const setWidthFromClientX = useCallback(
    (clientX: number) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      setWidth(clientX - rect.left);
    },
    [setWidth],
  );

  const resetWidth = useCallback(() => {
    if (!enabled) return;
    setPreferredWidth(
      clamp(DEFAULT_RATIO * bounds.availableWidth, bounds.min, bounds.max),
    );
  }, [bounds.availableWidth, bounds.min, bounds.max, enabled]);

  return {
    containerRef,
    previewPaneRef: setPreviewPaneElement,
    previewContainerRef: setPreviewContainerElement,
    minPreviewWidth,
    editorWidth,
    minWidth: bounds.min,
    maxWidth: bounds.max,
    keyboardStep: KEYBOARD_STEP,
    keyboardStepLarge: KEYBOARD_STEP_LARGE,
    isDragging,
    setDragging: setIsDragging,
    setWidth,
    setWidthFromClientX,
    resetWidth,
  };
}
