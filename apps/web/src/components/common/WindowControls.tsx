import { useWindowControls } from "../../hooks/useWindowControls";
import "./WindowControls.css";

interface WindowControlsProps {
  variant?: "header" | "compact";
}

export function WindowControls({ variant = "header" }: WindowControlsProps) {
  const { minimize, maximize, close } = useWindowControls();
  const className =
    variant === "compact" ? "window-controls-compact" : "window-controls";

  return (
    <div className={className}>
      <button
        className="win-btn win-minimize"
        onClick={() => minimize?.()}
        aria-label="最小化"
      >
        <svg width="10" height="1" viewBox="0 0 10 1">
          <rect width="10" height="1" fill="currentColor" />
        </svg>
      </button>
      <button
        className="win-btn win-maximize"
        onClick={() => maximize?.()}
        aria-label="最大化"
      >
        <svg width="10" height="10" viewBox="0 0 10 10">
          <rect
            width="9"
            height="9"
            x="0.5"
            y="0.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
          />
        </svg>
      </button>
      <button
        className="win-btn win-close"
        onClick={() => close?.()}
        aria-label="关闭"
      >
        <svg width="10" height="10" viewBox="0 0 10 10">
          <path
            d="M0,0 L10,10 M10,0 L0,10"
            stroke="currentColor"
            strokeWidth="1.2"
          />
        </svg>
      </button>
    </div>
  );
}
