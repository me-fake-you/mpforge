// 自定义主题持久化：工作区文件夹为真源，localStorage 仅作镜像
import toast from "react-hot-toast";
import { generateCSS } from "../components/Theme/ThemeDesigner/generateCSS";
import {
  buildWorkspaceThemeFile,
  type WorkspaceThemeBackend,
} from "../services/theme/themeStorageBackend";
import type { CustomTheme } from "./themes/builtInThemes";

/** 沿用原 key：老用户已有数据天然成为镜像 */
const MIRROR_KEY = "wemd-custom-themes";
/** 记录本机已经比对过哪些工作区，避免重复询问 */
const RECONCILED_KEY = "wemd-theme-reconciled-workspaces";

const getBrowserStorage = (): Storage | null => {
  if (typeof window === "undefined") return null;
  try {
    const storage = window.localStorage as Partial<Storage>;
    if (
      typeof storage.getItem !== "function" ||
      typeof storage.setItem !== "function"
    ) {
      return null;
    }
    return storage as Storage;
  } catch {
    return null;
  }
};

/**
 * 文件夹里的主题文件可被同步工具或用户手改，条目形状不可信，
 * 缺少必要字段的主题会让预览与深色模式转换直接抛错，必须在入口丢弃
 */
const isUsableTheme = (item: unknown): item is CustomTheme => {
  if (!item || typeof item !== "object") return false;
  const theme = item as Partial<CustomTheme>;
  return (
    typeof theme.id === "string" &&
    theme.id.length > 0 &&
    typeof theme.name === "string" &&
    typeof theme.css === "string"
  );
};

/**
 * 可视化主题的 CSS 由变量重新生成，保证旧数据也能享受生成器修复
 */
export const normalizeStoredThemes = (themes: CustomTheme[]): CustomTheme[] =>
  themes.filter(isUsableTheme).map((item) => {
    const variables = item.designerVariables;
    let css = item.css;

    if (variables) {
      if (!variables.underlineStyle) variables.underlineStyle = "solid";
      if (!variables.underlineColor) variables.underlineColor = "currentColor";
      css = generateCSS(variables);
    }

    return {
      ...item,
      css,
      designerVariables: variables,
      editorMode: item.editorMode || (variables ? "visual" : "css"),
    };
  });

export const loadMirrorThemes = (): CustomTheme[] => {
  const storage = getBrowserStorage();
  if (!storage) return [];
  try {
    const stored = storage.getItem(MIRROR_KEY);
    if (!stored) return [];
    return normalizeStoredThemes(JSON.parse(stored) as CustomTheme[]);
  } catch (error) {
    console.error("加载自定义主题失败:", error);
    return [];
  }
};

export const saveMirrorThemes = (themes: CustomTheme[]): void => {
  const storage = getBrowserStorage();
  if (!storage) return;
  try {
    storage.setItem(MIRROR_KEY, JSON.stringify(themes));
  } catch (error) {
    console.error("保存自定义主题失败:", error);
  }
};

const readReconciled = (): string[] => {
  const storage = getBrowserStorage();
  if (!storage) return [];
  try {
    const stored = storage.getItem(RECONCILED_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
};

export const markWorkspaceReconciled = (workspaceId: string): void => {
  const storage = getBrowserStorage();
  if (!storage || !workspaceId) return;
  const list = readReconciled();
  if (list.includes(workspaceId)) return;
  try {
    storage.setItem(RECONCILED_KEY, JSON.stringify([...list, workspaceId]));
  } catch {
    /* 存储不可用时最多多问一次，不影响主流程 */
  }
};

export interface WorkspaceThemeLoadResult {
  themes: CustomTheme[];
  /** 为空表示文件夹尚无主题文件，等首次保存主题时才创建 */
  workspaceId: string | null;
  /** 只存在于本机、文件夹中没有的主题，等待用户决定是否加入 */
  pendingLocalOnly: CustomTheme[];
  /** 文件夹还没有主题文件，需要调用方把当前主题写进去 */
  needsFirstWrite: boolean;
}

/**
 * 加载工作区主题：文件缺失时交给调用方写入，存在时以文件为准，并列出本机独有的主题
 *
 * 这里只读不写。首次写入必须回到 store，才能用读取完成时的最新主题、
 * 走同一条串行写队列，避免读取期间的新建主题被覆盖或重复写入。
 */
export const loadWorkspaceThemes = async (
  backend: WorkspaceThemeBackend,
): Promise<WorkspaceThemeLoadResult> => {
  const mirror = loadMirrorThemes();
  const file = await backend.read();

  if (!file) {
    return {
      themes: mirror,
      workspaceId: null,
      pendingLocalOnly: [],
      // 本机没有自定义主题时不写文件，避免在从不使用主题的文件夹里凭空建目录
      needsFirstWrite: mirror.length > 0,
    };
  }

  const themes = normalizeStoredThemes(file.themes);
  const known = new Set(themes.map((item) => item.id));
  const pendingLocalOnly = readReconciled().includes(file.workspaceId)
    ? []
    : mirror.filter((item) => !known.has(item.id));

  return {
    themes,
    workspaceId: file.workspaceId,
    pendingLocalOnly,
    needsFirstWrite: false,
  };
};

/**
 * 镜像同步写入在前，文件夹异步写入在后：任何失败都退回原有行为，主题不丢
 *
 * @returns 本次写入使用的 workspaceId，无后端时为 null
 */
export const persistThemes = (
  themes: CustomTheme[],
  backend: WorkspaceThemeBackend | null,
  workspaceId: string | null,
): string | null => {
  saveMirrorThemes(themes);
  if (!backend) return null;

  const file = buildWorkspaceThemeFile(themes, workspaceId ?? undefined);
  void backend.write(file).catch((error) => {
    console.error("写入工作区主题失败:", error);
    toast.error("主题未能写入本地文件夹，已保存在本机，恢复访问后会重新写入");
  });

  return file.workspaceId;
};
