import type { IpcMainInvokeEvent } from "electron";
import { ipcMain } from "electron";
import { getWorkspaceDir } from "../workspace/state";
import { readThemeFile, writeThemeFile } from "../workspace/themeStorage";

export function registerThemeHandlers(): void {
  ipcMain.handle("theme:read", async () => {
    const workspaceDir = getWorkspaceDir();
    if (!workspaceDir) return { success: false, error: "No workspace selected" };

    try {
      return { success: true, content: readThemeFile(workspaceDir) };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(
    "theme:write",
    async (_event: IpcMainInvokeEvent, content: string) => {
      const workspaceDir = getWorkspaceDir();
      if (!workspaceDir)
        return { success: false, error: "No workspace selected" };
      if (typeof content !== "string") {
        return { success: false, error: "主题内容格式错误" };
      }

      try {
        writeThemeFile(workspaceDir, content);
        return { success: true };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  );
}
