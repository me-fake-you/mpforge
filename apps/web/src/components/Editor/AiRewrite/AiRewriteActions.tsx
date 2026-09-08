import { useState } from "react";
import { ChevronRight, CornerDownLeft } from "lucide-react";

import {
  MAX_INSTRUCTION_CHARS,
  REWRITE_ACTIONS,
  TONE_OPTIONS,
  type RewriteActionId,
  type ToneId,
} from "../../../services/ai/aiPrompts";

interface AiRewriteActionsProps {
  onRun: (
    action: RewriteActionId,
    extra?: { tone?: ToneId; instruction?: string },
  ) => void;
}

export function AiRewriteActions({ onRun }: AiRewriteActionsProps) {
  const [showTones, setShowTones] = useState(false);
  const [instruction, setInstruction] = useState("");

  const submitCustom = () => {
    if (!instruction.trim()) return;
    onRun("custom", { instruction });
  };

  return (
    <div className="ai-rewrite-actions">
      <ul className="ai-action-list">
        {REWRITE_ACTIONS.map((action) =>
          action.id === "tone" ? (
            <li key={action.id} className="ai-action-item-wrapper">
              <button
                type="button"
                className="ai-action-item"
                aria-expanded={showTones}
                onClick={() => setShowTones((prev) => !prev)}
              >
                {action.label}
                <ChevronRight
                  size={13}
                  className={showTones ? "is-open" : undefined}
                />
              </button>
              {showTones && (
                <ul className="ai-tone-list">
                  {TONE_OPTIONS.map((tone) => (
                    <li key={tone.id}>
                      <button
                        type="button"
                        className="ai-action-item"
                        onClick={() => onRun("tone", { tone: tone.id })}
                      >
                        {tone.label}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ) : (
            <li key={action.id}>
              <button
                type="button"
                className="ai-action-item"
                onClick={() => onRun(action.id)}
              >
                {action.label}
              </button>
            </li>
          ),
        )}
      </ul>

      <div className="ai-custom-instruction">
        <input
          type="text"
          placeholder="或输入自定义要求"
          maxLength={MAX_INSTRUCTION_CHARS}
          value={instruction}
          aria-label="自定义要求"
          onChange={(event) => setInstruction(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submitCustom();
            }
          }}
        />
        <button
          type="button"
          className="ai-custom-submit"
          aria-label="执行自定义要求"
          disabled={!instruction.trim()}
          onClick={submitCustom}
        >
          <CornerDownLeft size={14} />
        </button>
      </div>
    </div>
  );
}
