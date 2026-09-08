import { create } from "zustand";

export type AppView =
  | "dashboard"
  | "editor"
  | "review"
  | "assets"
  | "publish"
  | "settings";

interface AppViewState {
  activeView: AppView;
  selectedArticlePath: string | null;
  setActiveView: (view: AppView) => void;
  selectArticle: (path: string | null) => void;
  openArticle: (path: string) => void;
}

export const useAppViewStore = create<AppViewState>((set) => ({
  activeView: "editor",
  selectedArticlePath: null,
  setActiveView: (activeView) => set({ activeView }),
  selectArticle: (selectedArticlePath) => set({ selectedArticlePath }),
  openArticle: (selectedArticlePath) =>
    set({ selectedArticlePath, activeView: "editor" }),
}));
