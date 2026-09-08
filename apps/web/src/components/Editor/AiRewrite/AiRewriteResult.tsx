import { Settings2 } from "lucide-react";

import { PixelLoader, ThinkingTrace } from "../../common";

interface AiRewriteResultProps {
  phase: "streaming" | "done" | "error";
  reasoning?: string;
  thinkingMs?: number;
  message?: string;
  showSettingsLink?: boolean;
  onApply: () => void;
  onRetry: () => void;
  onCancel: () => void;
  onOpenSettings: () => void;
}

export function AiRewriteResult({
  phase,
  reasoning = "",
  thinkingMs = 0,
  message,
  showSettingsLink,
  onApply,
  onRetry,
  onCancel,
  onOpenSettings,
}: AiRewriteResultProps) {
  if (phase === "error") {
    return (
      <div className="ai-rewrite-result">
        <p className="ai-result-error">{message}</p>
        <div className="ai-result-footer">
          {showSettingsLink && (
            <button
              type="button"
              className="ai-result-link"
              onClick={onOpenSettings}
            >
              <Settings2 size={13} />
              检查设置
            </button>
          )}
          <button type="button" className="ai-result-btn" onClick={onCancel}>
            关闭
          </button>
          <button
            type="button"
            className="ai-result-btn is-primary"
            onClick={onRetry}
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ai-rewrite-result">
      <ThinkingTrace
        text={reasoning}
        active={phase === "streaming"}
        durationMs={thinkingMs}
      />
      <div className="ai-result-footer is-bare">
        {phase === "streaming" ? (
          <>
            <PixelLoader label="正在改写" />
            <button type="button" className="ai-result-btn" onClick={onCancel}>
              停止
            </button>
          </>
        ) : (
          <>
            <button type="button" className="ai-result-btn" onClick={onCancel}>
              取消
            </button>
            <button type="button" className="ai-result-btn" onClick={onRetry}>
              重试
            </button>
            <button
              type="button"
              className="ai-result-btn is-primary"
              onClick={onApply}
            >
              替换
            </button>
          </>
        )}
      </div>
    </div>
  );
}
