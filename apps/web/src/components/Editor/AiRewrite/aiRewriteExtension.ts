import { EditorView, ViewPlugin } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

import { checkSelection } from "../../../services/ai/aiSelection";

// 键盘连续改选区时等它停下来再出浮标
export const SELECTION_SETTLE_MS = 180;

export interface RewriteAnchor {
  from: number;
  to: number;
  left: number;
  top: number;
}

export interface AiRewriteHandlers {
  onAnchorChange: (anchor: RewriteAnchor | null) => void;
  isEnabled: () => boolean;
}

export function computeAnchor(view: EditorView): RewriteAnchor | null {
  const { from, to } = view.state.selection.main;
  if (from === to) return null;

  const doc = view.state.doc.toString();
  if (!checkSelection(doc, from, to).ok) return null;

  const coords = view.coordsAtPos(to);
  if (!coords) return null;

  // 选区滚出可视区时收起浮标
  const bounds = view.scrollDOM.getBoundingClientRect();
  if (coords.bottom < bounds.top || coords.top > bounds.bottom) return null;

  return { from, to, left: coords.left, top: coords.top };
}

export function sameAnchor(
  a: RewriteAnchor | null,
  b: RewriteAnchor | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.from === b.from && a.to === b.to && a.left === b.left && a.top === b.top
  );
}

export function createAnchorReporter(handlers: AiRewriteHandlers) {
  let last: RewriteAnchor | null = null;

  const emit = (next: RewriteAnchor | null) => {
    if (sameAnchor(next, last)) return;
    last = next;
    handlers.onAnchorChange(next);
  };

  return {
    report: (view: EditorView) =>
      emit(handlers.isEnabled() ? computeAnchor(view) : null),
    hide: () => emit(null),
  };
}

export function aiRewriteExtension(handlers: AiRewriteHandlers): Extension {
  const tracker = ViewPlugin.define((view) => {
    const reporter = createAnchorReporter(handlers);
    let dragging = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const clear = () => {
      if (timer === undefined) return;
      clearTimeout(timer);
      timer = undefined;
    };

    const flush = () => {
      clear();
      reporter.report(view);
    };

    const schedule = () => {
      clear();
      timer = setTimeout(flush, SELECTION_SETTLE_MS);
    };

    // 鼠标松开可能发生在编辑器之外，挂在 document 上才收得到
    const onPointerUp = () => {
      if (!dragging) return;
      dragging = false;
      flush();
    };
    document.addEventListener("mouseup", onPointerUp);

    return {
      selectionChanged: () => {
        if (dragging) return;
        schedule();
      },
      pointerDown: () => {
        dragging = true;
        clear();
        reporter.hide();
      },
      scrolled: () => {
        if (dragging) return;
        flush();
      },
      destroy: () => {
        clear();
        document.removeEventListener("mouseup", onPointerUp);
      },
    };
  });

  return [
    tracker,
    EditorView.updateListener.of((update) => {
      if (!update.selectionSet && !update.docChanged && !update.geometryChanged)
        return;
      update.view.plugin(tracker)?.selectionChanged();
    }),
    EditorView.domEventHandlers({
      mousedown: (_event, view) => {
        view.plugin(tracker)?.pointerDown();
      },
      scroll: (_event, view) => {
        view.plugin(tracker)?.scrolled();
      },
    }),
  ];
}
