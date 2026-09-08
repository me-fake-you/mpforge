// 主题工作区同步：文件夹真源加载、本机独有主题比对与询问状态
import toast from "react-hot-toast";
import type { ThemeStore } from "./themeStore";
import type { CustomTheme } from "./themes/builtInThemes";
import type { WorkspaceThemeBackend } from "../services/theme/themeStorageBackend";
import {
  loadMirrorThemes,
  loadWorkspaceThemes,
  markWorkspaceReconciled,
} from "./themePersistence";

/** 主题 Store 的工作区同步切片（状态与方法） */
export interface WorkspaceThemeSlice {
  /** 为空表示无文件夹能力，主题回落 localStorage */
  workspaceBackend: WorkspaceThemeBackend | null;
  workspaceId: string | null;
  /** 只存在于本机、当前工作区没有的主题，等待用户确认是否加入 */
  pendingLocalOnlyThemes: CustomTheme[];
  /** 文件夹主题文件损坏：只更新镜像不覆盖文件，重新加载成功前保持 */
  workspaceFileBroken: boolean;
  setWorkspaceThemeBackend: (backend: WorkspaceThemeBackend | null) => void;
  loadWorkspaceThemes: () => Promise<void>;
  acceptPendingThemes: () => void;
  /** 明确选择不加入，之后不再询问该文件夹 */
  dismissPendingThemes: () => void;
  /** 关闭弹窗但不记住选择，下次打开该文件夹仍会询问 */
  snoozePendingThemes: () => void;
}

interface SliceDeps {
  /** 主题统一写入入口（内存/镜像/文件夹），由 store 注入以回填 workspaceId */
  persist: (themes: CustomTheme[]) => void;
  clearDarkCssCache: () => void;
  saveSelectedTheme: (themeId: string, themeName: string) => void;
}

type SliceSet = (partial: Partial<ThemeStore>) => void;
type SliceGet = () => ThemeStore;

export const createWorkspaceThemeSlice = (
  set: SliceSet,
  get: SliceGet,
  deps: SliceDeps,
): WorkspaceThemeSlice => {
  const { persist, clearDarkCssCache, saveSelectedTheme } = deps;

  return {
    workspaceBackend: null,
    workspaceId: null,
    pendingLocalOnlyThemes: [],
    workspaceFileBroken: false,

    setWorkspaceThemeBackend: (backend) => {
      if (get().workspaceBackend === backend) return;
      set({
        workspaceBackend: backend,
        workspaceId: null,
        workspaceFileBroken: false,
      });
      if (!backend) {
        set({ customThemes: loadMirrorThemes(), pendingLocalOnlyThemes: [] });
      }
    },

    loadWorkspaceThemes: async () => {
      const backend = get().workspaceBackend;
      if (!backend) return;

      let result;
      try {
        result = await loadWorkspaceThemes(backend);
      } catch (error) {
        // 文件损坏或无权访问：保留内存与镜像，不覆盖写回；
        // 标记损坏，后续保存只更新镜像，避免以新 workspaceId 盲写覆盖损坏文件
        console.error("读取工作区主题失败:", error);
        toast.error("本地文件夹中的主题文件无法读取，本次使用本机保存的主题");
        set({ workspaceFileBroken: true });
        return;
      }

      // 后端在读取期间被替换（工作区切换）时丢弃本次结果
      if (get().workspaceBackend !== backend) return;

      clearDarkCssCache();
      set({ workspaceFileBroken: false });

      if (result.needsFirstWrite) {
        // 用读取完成时的最新主题写入文件夹，读取期间新建的主题不会被覆盖
        const themesToWrite = get().customThemes.length
          ? get().customThemes
          : result.themes;
        set({ customThemes: themesToWrite, pendingLocalOnlyThemes: [] });
        persist(themesToWrite);
        const newWorkspaceId = get().workspaceId;
        if (newWorkspaceId) markWorkspaceReconciled(newWorkspaceId);
        return;
      }

      set({
        customThemes: result.themes,
        workspaceId: result.workspaceId,
        pendingLocalOnlyThemes: result.pendingLocalOnly,
      });

      // 当前主题可能不在新工作区中，避免预览挂着不存在的主题 CSS
      const state = get();
      const exists = state
        .getAllThemes()
        .some((item) => item.id === state.themeId);
      if (!exists) {
        set({ themeId: "default", themeName: "默认主题", customCSS: "" });
        saveSelectedTheme("default", "默认主题");
      }
    },

    acceptPendingThemes: () => {
      const state = get();
      if (state.pendingLocalOnlyThemes.length === 0) return;

      const nextCustomThemes = [
        ...state.customThemes,
        ...state.pendingLocalOnlyThemes,
      ];
      persist(nextCustomThemes);
      clearDarkCssCache();
      set({ customThemes: nextCustomThemes, pendingLocalOnlyThemes: [] });
      const workspaceId = get().workspaceId;
      if (workspaceId) markWorkspaceReconciled(workspaceId);
    },

    dismissPendingThemes: () => {
      const { workspaceId } = get();
      if (workspaceId) markWorkspaceReconciled(workspaceId);
      set({ pendingLocalOnlyThemes: [] });
    },

    snoozePendingThemes: () => {
      set({ pendingLocalOnlyThemes: [] });
    },
  };
};
