import { useRef, type PointerEvent as ReactPointerEvent } from "react";

interface ResizeHandleProps {
  width: number;
  minWidth: number;
  maxWidth: number;
  step?: number;
  stepLarge?: number;
  onWidthChange: (width: number) => void;
  onPointerPosition: (clientX: number) => void;
  onReset: () => void;
  onDraggingChange?: (dragging: boolean) => void;
}

export function ResizeHandle({
  width,
  minWidth,
  maxWidth,
  step = 16,
  stepLarge = 64,
  onWidthChange,
  onPointerPosition,
  onReset,
  onDraggingChange,
}: ResizeHandleProps) {
  const draggingRef = useRef(false);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    draggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    onDraggingChange?.(true);
    onPointerPosition(event.clientX);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    onPointerPosition(event.clientX);
  };

  const finishDragging = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onDraggingChange?.(false);
  };

  return (
    <div
      className="workspace-resize-handle"
      role="separator"
      aria-label="调整编辑器与预览宽度"
      aria-orientation="vertical"
      aria-valuemin={Math.round(minWidth)}
      aria-valuemax={Math.round(maxWidth)}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDragging}
      onPointerCancel={finishDragging}
      onDoubleClick={onReset}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const direction = event.key === "ArrowLeft" ? -1 : 1;
        const delta = event.shiftKey ? stepLarge : step;
        onWidthChange(width + direction * delta);
      }}
    >
      <span className="workspace-resize-handle__line" aria-hidden="true" />
    </div>
  );
}
