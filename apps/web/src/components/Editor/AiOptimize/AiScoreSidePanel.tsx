import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import { useAiPanelStore } from "../../../store/aiPanelStore";
import { useEditorStore } from "../../../store/editorStore";
import { AiScorePanel } from "./AiScorePanel";
import "./AiOptimize.css";

interface AiScoreSidePanelProps {
  hidden?: boolean;
  closing?: boolean;
}

export function AiScoreSidePanel({ hidden, closing }: AiScoreSidePanelProps) {
  const markdown = useEditorStore((state) => state.markdown);
  const closeScorePanel = useAiPanelStore((state) => state.closeScorePanel);
  const editorActions = useAiPanelStore((state) => state.editorActions);
  // 重新审阅＝整块换掉重来：正文按当前值重新读取，采纳/撤销等状态一并清空
  const [runId, setRunId] = useState(0);
  const [needsRerun, setNeedsRerun] = useState(false);
  const wasHiddenRef = useRef(Boolean(hidden));

  useEffect(() => {
    if (!hidden && wasHiddenRef.current && needsRerun) {
      setRunId((id) => id + 1);
      setNeedsRerun(false);
    }
    wasHiddenRef.current = Boolean(hidden);
  }, [hidden, needsRerun]);

  return (
    <aside
      className={`ai-score-side${closing ? " is-closing" : ""}`}
      aria-label="全文审阅"
      hidden={hidden}
    >
      <header className="ai-score-side-head">
        <div>
          <h2>全文审阅</h2>
          <p>通读全文，指出问题并给出可采纳的改写</p>
        </div>
        <button
          type="button"
          className="ai-score-side-close"
          aria-label="关闭全文审阅"
          onClick={closeScorePanel}
        >
          <X size={16} />
        </button>
      </header>

      <div className="ai-score-side-body">
        <AiScorePanel
          key={runId}
          onRerun={() => setRunId((id) => id + 1)}
          markdown={markdown}
          onClose={closeScorePanel}
          editorActions={editorActions}
          variant="side"
          onCanceled={() => setNeedsRerun(true)}
        />
      </div>
    </aside>
  );
}
