import { PenLine } from "lucide-react";

import { AiRewritePopover } from "./AiRewritePopover";
import type { RewriteAnchor } from "./aiRewriteExtension";
import type { RewriteTarget } from "./useAiRewrite";
import "./AiRewrite.css";

interface AiRewriteLauncherProps {
  anchor: RewriteAnchor | null;
  target: RewriteTarget | null;
  onOpen: () => void;
  onClose: () => void;
  onApply: (text: string) => void;
  onPreview: (text: string | null) => void;
}

export function AiRewriteLauncher({
  anchor,
  target,
  onOpen,
  onClose,
  onApply,
  onPreview,
}: AiRewriteLauncherProps) {
  return (
    <>
      {anchor && (
        <button
          type="button"
          className="ai-rewrite-anchor"
          style={{ left: anchor.left, top: anchor.top }}
          aria-label="AI 改写"
          title="AI 改写"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onOpen}
        >
          <PenLine size={13} />
          <span>改写</span>
        </button>
      )}
      {target && (
        <AiRewritePopover
          left={target.left}
          top={target.top}
          selected={target.selected}
          context={target.context}
          onApply={onApply}
          onClose={onClose}
          onPreview={onPreview}
        />
      )}
    </>
  );
}
