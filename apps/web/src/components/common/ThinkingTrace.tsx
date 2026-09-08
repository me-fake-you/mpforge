import { useState } from "react";
import { ChevronRight } from "lucide-react";

import "./ThinkingTrace.css";

interface ThinkingTraceProps {
  text: string;
  /** 仍在思考中；结束后改为过去式并保留耗时 */
  active: boolean;
  durationMs: number;
}

export function ThinkingTrace({
  text,
  active,
  durationMs,
}: ThinkingTraceProps) {
  const [open, setOpen] = useState(false);
  if (!text.trim()) return null;

  const seconds = (durationMs / 1000).toFixed(1);
  const label = active ? `正在思考 ${seconds}s` : `思考了 ${seconds} 秒`;

  return (
    <div className={`thinking-trace${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="thinking-trace-toggle"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <ChevronRight size={13} className="thinking-trace-caret" />
        <span>{label}</span>
      </button>

      <div className="thinking-trace-shell">
        <div className="thinking-trace-clip">
          <div className="thinking-trace-body">{text}</div>
        </div>
      </div>
    </div>
  );
}
