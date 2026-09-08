import * as fs from "fs";
import * as path from "path";

/** 隐藏目录，避免主题文件进入文章列表与 watcher */
export const THEME_STORAGE_DIR = ".mpforge";
export const THEME_STORAGE_FILE = "themes.json";

/**
 * 主题文件路径由工作区推导，不接受外部路径参数，避免越权写入
 */
export function resolveThemeFilePath(workspaceDir: string): string {
  return path.join(workspaceDir, THEME_STORAGE_DIR, THEME_STORAGE_FILE);
}

/**
 * 读取工作区主题文件；文件不存在返回 null
 */
export function readThemeFile(workspaceDir: string): string | null {
  const filePath = resolveThemeFilePath(workspaceDir);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf-8");
}

/**
 * 写入工作区主题文件，隐藏目录不存在时自动创建
 */
export function writeThemeFile(workspaceDir: string, content: string): void {
  const filePath = resolveThemeFilePath(workspaceDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
}
