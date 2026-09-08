import type { IpcMainInvokeEvent } from "electron";
import { ClipboardItem, clipboard, ipcMain } from "electron";
import { createClipboardOperations } from "./clipboardOperations";

export function registerClipboardHandlers(): void {
  const operations = createClipboardOperations(
    clipboard,
    (data) => new ClipboardItem(data),
  );
  ipcMain.handle(
    "clipboard:writeHTML",
    async (
      _event: IpcMainInvokeEvent,
      payload: { html?: string; text?: string },
    ) => operations.writeHTML(payload),
  );

  ipcMain.handle(
    "clipboard:writeText",
    async (_event: IpcMainInvokeEvent, text: string) =>
      operations.writeText(text),
  );
}
