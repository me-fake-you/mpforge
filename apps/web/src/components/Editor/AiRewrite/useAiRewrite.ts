import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import toast from "react-hot-toast";

import {
  isAiRewriteReady,
  subscribeAiConfig,
} from "../../../services/ai/aiConfig";
import {
  CONTEXT_CHARS,
  extractContext,
  type SelectionContext,
} from "../../../services/ai/aiSelection";
import { useMobileView } from "../../../hooks/useMobileView";
import { aiRewriteExtension, type RewriteAnchor } from "./aiRewriteExtension";
import { rewritePreviewField, setRewritePreview } from "./aiPreviewWidget";

export interface RewriteTarget {
  from: number;
  to: number;
  selected: string;
  context: SelectionContext;
  left: number;
  top: number;
}

export function useAiRewrite(viewRef: { current: EditorView | null }) {
  const [configured, setConfigured] = useState(() => isAiRewriteReady());
  const [anchor, setAnchor] = useState<RewriteAnchor | null>(null);
  const [target, setTarget] = useState<RewriteTarget | null>(null);
  // 移动端浮标会和系统选择菜单抢位置
  const { isMobile } = useMobileView();
  const ready = configured && !isMobile;

  const readyRef = useRef(ready);
  readyRef.current = ready;
  const targetRef = useRef(target);
  targetRef.current = target;

  useEffect(
    () => subscribeAiConfig(() => setConfigured(isAiRewriteReady())),
    [],
  );

  const openAt = useCallback(
    (from: number, to: number, coords?: { left: number; top: number }) => {
      const view = viewRef.current;
      if (!view) return;

      const doc = view.state.doc.toString();
      const position = coords ?? view.coordsAtPos(to);
      if (!position) return;

      setTarget({
        from,
        to,
        selected: doc.slice(from, to),
        context: extractContext(doc, from, to, CONTEXT_CHARS),
        left: position.left,
        top: position.top,
      });
    },
    [viewRef],
  );

  const handlersRef = useRef({
    onAnchorChange: setAnchor,
    isEnabled: () => readyRef.current,
  });

  const extension = useMemo(
    () => [
      rewritePreviewField,
      aiRewriteExtension({
        onAnchorChange: (next) => handlersRef.current.onAnchorChange(next),
        isEnabled: () => handlersRef.current.isEnabled(),
      }),
    ],
    [],
  );

  const openFromAnchor = useCallback(() => {
    if (!anchor) return;
    openAt(anchor.from, anchor.to, { left: anchor.left, top: anchor.top });
  }, [anchor, openAt]);

  const preview = useCallback(
    (text: string | null) => {
      const view = viewRef.current;
      const current = targetRef.current;
      if (!view || !current) return;

      view.dispatch({
        effects: setRewritePreview.of(
          text === null ? null : { to: current.to, text },
        ),
      });
    },
    [viewRef],
  );

  const clearPreview = useCallback(() => {
    viewRef.current?.dispatch({ effects: setRewritePreview.of(null) });
  }, [viewRef]);

  const close = useCallback(() => {
    clearPreview();
    setTarget(null);
  }, [clearPreview]);

  const apply = useCallback(
    (text: string) => {
      const view = viewRef.current;
      const current = targetRef.current;
      if (!view || !current) return;

      // 流式期间用户可能改动过原文，偏移会失效
      const stillMatches =
        view.state.doc.sliceString(current.from, current.to) ===
        current.selected;
      if (!stillMatches) {
        toast.error("原文已改动，未替换。请重新选中后再试");
        clearPreview();
        setTarget(null);
        return;
      }

      clearPreview();

      view.dispatch({
        changes: { from: current.from, to: current.to, insert: text },
        selection: { anchor: current.from + text.length },
      });
      setTarget(null);
      view.focus();
    },
    [viewRef, clearPreview],
  );

  return {
    extension,
    preview,
    ready,
    openAt,
    anchor: target ? null : anchor,
    target,
    openFromAnchor,
    close,
    apply,
  };
}
