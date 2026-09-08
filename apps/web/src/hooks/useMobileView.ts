import { useState, useEffect } from "react";

const MOBILE_BREAKPOINT = 768;

export type MobileViewType = "editor" | "preview";

// 仅当主指针为粗指针(真实触屏设备)时才视为移动端;
// 桌面浏览器把窗口拖窄不应折叠成移动布局
const isCoarsePointer = (): boolean => {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return false;
  }
  return window.matchMedia("(pointer: coarse)").matches;
};

const detectMobile = (): boolean => {
  if (typeof window === "undefined") return false;
  return window.innerWidth < MOBILE_BREAKPOINT && isCoarsePointer();
};

export function useMobileView() {
  const [isMobile, setIsMobile] = useState(detectMobile);

  const [activeView, setActiveView] = useState<MobileViewType>("editor");

  useEffect(() => {
    const handleResize = () => {
      const mobile = detectMobile();
      setIsMobile(mobile);
      if (!mobile) {
        setActiveView("editor");
      }
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return {
    isMobile,
    activeView,
    setActiveView,
    isEditor: activeView === "editor",
    isPreview: activeView === "preview",
  };
}
