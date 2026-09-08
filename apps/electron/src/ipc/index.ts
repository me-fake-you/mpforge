import type { BrowserWindow } from "electron";
import { registerClipboardHandlers } from "./clipboardHandlers";
import { registerFileHandlers } from "./fileHandlers";
import { registerFolderHandlers } from "./folderHandlers";
import { registerShellHandlers } from "./shellHandlers";
import { registerThemeHandlers } from "./themeHandlers";
import { registerUpdateHandlers } from "./updateHandlers";
import { registerWindowHandlers } from "./windowHandlers";
import { registerWorkspaceHandlers } from "./workspaceHandlers";
import { registerAssetHandlers } from "./assetHandlers";
import { registerReviewHandlers } from "./reviewHandlers";
import { registerDraftWorkspaceHandlers } from "./draftWorkspaceHandlers";

export function registerIpcHandlers(
  getWindow: () => BrowserWindow | null,
): void {
  registerWindowHandlers(getWindow);
  registerWorkspaceHandlers(getWindow);
  registerAssetHandlers(getWindow);
  registerReviewHandlers();
  registerDraftWorkspaceHandlers();
  registerFileHandlers();
  registerFolderHandlers();
  registerThemeHandlers();
  registerShellHandlers();
  registerClipboardHandlers();
  registerUpdateHandlers();
}
