import { create } from "zustand";

import type { TextRange } from "../services/ai/aiLocate";
import { cancelActiveAiRequest } from "../services/ai/aiRequestCoordinator";

/** 审阅侧栏对正文的操作，由 MarkdownEditor 注册实现 */
export interface EditorTextActions {
  /** 定位并选中原文片段，找不到返回 false */
  reveal: (quote: string) => boolean;
  /** 用建议文字替换原文片段，回传替换后的区间与被替换掉的原文 */
  applyFix: (
    quote: string,
    replacement: string,
  ) => { range: TextRange; original: string } | null;
  /** 把区间还原成原文，正文已被改动到找不到时返回 false */
  revertFix: (range: TextRange, applied: string, original: string) => boolean;
}

interface AiPanelStore {
  scorePanelOpen: boolean;
  toggleScorePanel: () => void;
  closeScorePanel: () => void;

  editorActions: EditorTextActions | null;
  setEditorActions: (actions: EditorTextActions | null) => void;
}

export const useAiPanelStore = create<AiPanelStore>((set) => ({
  scorePanelOpen: false,
  toggleScorePanel: () =>
    set((state) => {
      if (state.scorePanelOpen) cancelActiveAiRequest();
      return { scorePanelOpen: !state.scorePanelOpen };
    }),
  closeScorePanel: () => {
    cancelActiveAiRequest();
    set({ scorePanelOpen: false });
  },

  editorActions: null,
  setEditorActions: (actions) => set({ editorActions: actions }),
}));
