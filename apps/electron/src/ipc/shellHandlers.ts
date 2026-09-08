import type { IpcMainInvokeEvent } from "electron";
import { ipcMain, shell } from "electron";

export function registerShellHandlers(): void {
  ipcMain.handle(
    "shell:openExternal",
    async (_event: IpcMainInvokeEvent, url: string) => {
      if (url && (url.startsWith("http://") || url.startsWith("https://"))) {
        await shell.openExternal(url);
      }
    },
  );
}
