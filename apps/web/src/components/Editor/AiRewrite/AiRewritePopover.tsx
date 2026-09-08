import { useEffect, useRef, useState } from "react";

import {
  AiRequestError,
  streamChatCompletion,
} from "../../../services/ai/aiClient";
import {
  getAiConfig,
  requestOpenAiSettings,
} from "../../../services/ai/aiConfig";
import {
  buildRewriteMessages,
  sanitizeRewriteOutput,
  type RewriteActionId,
  type RewriteRequest,
  type ToneId,
} from "../../../services/ai/aiPrompts";
import type { SelectionContext } from "../../../services/ai/aiSelection";
import { AiRewriteActions } from "./AiRewriteActions";
import { AiRewriteResult } from "./AiRewriteResult";

type Phase =
  | { name: "actions" }
  | { name: "streaming"; chunks: string[] }
  | { name: "done"; text: string }
  | { name: "error"; message: string; showSettingsLink: boolean };

export interface AiRewritePopoverProps {
  left: number;
  top: number;
  selected: string;
  context: SelectionContext;
  onApply: (text: string) => void;
  onClose: () => void;
  onPreview: (text: string | null) => void;
}

const SETTINGS_ERROR_KINDS = new Set([
  "auth",
  "bad_request",
  "network",
  "timeout",
]);

export function AiRewritePopover({
  left,
  top,
  selected,
  context,
  onApply,
  onClose,
  onPreview,
}: AiRewritePopoverProps) {
  const [phase, setPhase] = useState<Phase>({ name: "actions" });
  const abortRef = useRef<AbortController | null>(null);
  const lastRequestRef = useRef<RewriteRequest | null>(null);
  const streamedRef = useRef("");
  const thinkStartRef = useRef(0);
  const [reasoning, setReasoning] = useState("");
  const [thinkingMs, setThinkingMs] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const [barPos, setBarPos] = useState<{ left: number; top: number } | null>(
    null,
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        abortRef.current?.abort();
        onClose();
      }
    };
    const handlePointerDown = (event: MouseEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) {
        abortRef.current?.abort();
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [onClose]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // 控制条挂到正文预览块下方，避免浮在选区上遮住原文
  useEffect(() => {
    if (phase.name !== "streaming" && phase.name !== "done") {
      setBarPos(null);
      return;
    }

    let observer: ResizeObserver | undefined;
    let raf = 0;
    let attempts = 0;

    const attach = () => {
      const block = document.querySelector<HTMLElement>(".cm-ai-preview");
      if (!block) {
        if (attempts++ > 30) return;
        raf = requestAnimationFrame(attach);
        return;
      }
      const update = () => {
        const rect = block.getBoundingClientRect();
        setBarPos({ left: rect.left, top: rect.bottom + 6 });
      };
      update();
      observer = new ResizeObserver(update);
      observer.observe(block);
    };
    attach();

    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
    };
  }, [phase.name]);

  const run = async (request: RewriteRequest) => {
    const config = getAiConfig();
    const messages = buildRewriteMessages(request, config.preference);
    if (!messages) return;

    lastRequestRef.current = request;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    streamedRef.current = "";
    thinkStartRef.current = 0;
    setReasoning("");
    setThinkingMs(0);
    onPreview("");
    setPhase({ name: "streaming", chunks: [] });

    try {
      const raw = await streamChatCompletion({
        config,
        messages,
        signal: controller.signal,
        onReasoning: (delta) => {
          if (!thinkStartRef.current) thinkStartRef.current = Date.now();
          setThinkingMs(Date.now() - thinkStartRef.current);
          setReasoning((prev) => prev + delta);
        },
        onDelta: (delta) => {
          // 正文一来就说明思考结束，冻住耗时
          if (thinkStartRef.current) {
            setThinkingMs(Date.now() - thinkStartRef.current);
            thinkStartRef.current = 0;
          }
          // 副作用必须留在 updater 之外：updater 在 render 阶段执行，
          // StrictMode 下会跑两次，且此时 dispatch 给编辑器不可靠
          streamedRef.current += delta;
          onPreview(streamedRef.current);
          setPhase((prev) =>
            prev.name === "streaming"
              ? { name: "streaming", chunks: [...prev.chunks, delta] }
              : prev,
          );
        },
      });
      const finalText = sanitizeRewriteOutput(raw);
      if (!finalText.trim() || finalText.trim() === selected.trim()) {
        throw new AiRequestError(
          "malformed",
          "模型没有生成可用改写，请重试或换一个动作",
        );
      }
      onPreview(finalText);
      setPhase({ name: "done", text: finalText });
    } catch (error) {
      onPreview(null);
      if (error instanceof AiRequestError && error.kind === "aborted") {
        setPhase({ name: "actions" });
        return;
      }
      const failure =
        error instanceof AiRequestError
          ? error
          : new AiRequestError("network", "改写失败，请稍后重试");
      setPhase({
        name: "error",
        message: failure.message,
        showSettingsLink: SETTINGS_ERROR_KINDS.has(failure.kind),
      });
    }
  };

  const handleRun = (
    action: RewriteActionId,
    extra?: { tone?: ToneId; instruction?: string },
  ) => {
    void run({ action, selected, context, ...extra });
  };

  const handleRetry = () => {
    if (lastRequestRef.current) void run(lastRequestRef.current);
    else setPhase({ name: "actions" });
  };

  const handleCancel = () => {
    abortRef.current?.abort();
    if (phase.name === "streaming") return;
    onClose();
  };

  const asBar = phase.name !== "actions";
  const anchored = asBar && barPos !== null;

  return (
    <div
      ref={panelRef}
      className={`ai-rewrite-popover${asBar ? " is-bar" : ""}${
        anchored ? " is-anchored" : ""
      }`}
      style={anchored ? { left: barPos.left, top: barPos.top } : { left, top }}
      role="dialog"
      aria-label="AI 改写"
    >
      {phase.name === "actions" ? (
        <AiRewriteActions onRun={handleRun} />
      ) : (
        <AiRewriteResult
          reasoning={reasoning}
          thinkingMs={thinkingMs}
          phase={phase.name}
          message={phase.name === "error" ? phase.message : undefined}
          showSettingsLink={
            phase.name === "error" ? phase.showSettingsLink : false
          }
          onApply={() => phase.name === "done" && onApply(phase.text)}
          onRetry={handleRetry}
          onCancel={handleCancel}
          onOpenSettings={() => {
            onClose();
            requestOpenAiSettings();
          }}
        />
      )}
    </div>
  );
}
