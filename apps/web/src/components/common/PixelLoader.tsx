import { useEffect, useRef, useState } from "react";

import "./PixelLoader.css";

// 对角波形的点亮次序
const PIXEL_DELAYS = [90, 180, 270, 0, 90, 180, 90, 180, 270];

export function PixelLoader({ label }: { label: string }) {
  const startedAt = useRef(Date.now());
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = setInterval(
      () => setElapsed((Date.now() - startedAt.current) / 1000),
      100,
    );
    return () => clearInterval(timer);
  }, []);

  return (
    <span className="pixel-loader" role="status">
      <span className="pixel-loader-grid" aria-hidden="true">
        {PIXEL_DELAYS.map((delay, index) => (
          <span key={index} style={{ animationDelay: `${delay}ms` }} />
        ))}
      </span>
      <span className="pixel-loader-label">{label}</span>
      <span className="pixel-loader-time">{elapsed.toFixed(1)}s</span>
    </span>
  );
}
