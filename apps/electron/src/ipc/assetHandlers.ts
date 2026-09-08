import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { dialog, ipcMain } from "electron";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { resolveWorkspaceArticleDirectory } from "../workspace/articlePath";
import { listArticleAssetFiles } from "../workspace/assetFiles";

type AssetRightsStatus = "approved" | "pending" | "blocked" | "unknown";
type AssetSourceType = "local" | "generated" | "user_owned" | "project_asset";

interface AssetMetadataPayload {
  importedBy: string;
  sourceType?: AssetSourceType;
  license?: string | null;
  creator?: string | null;
  attribution?: string | null;
  generationMethod?: string;
  userOwnedConfirmed?: boolean;
}

interface AssetActionPayload {
  articlePath: string;
}

interface LocalImportPayload extends AssetActionPayload, AssetMetadataPayload {}

interface RemoteImportPayload extends AssetActionPayload {
  sourceUrl: string;
  importedBy: string;
  rightsAcknowledged: boolean;
  license?: string | null;
  creator?: string | null;
  attribution?: string | null;
}

interface RightsPayload extends AssetActionPayload {
  assetId: string;
  rightsStatus: AssetRightsStatus;
  confirmedByHuman?: boolean;
  userOwnedConfirmed?: boolean;
  license?: string | null;
  creator?: string | null;
  attribution?: string | null;
}

interface MediaModule {
  importAssetBytes: (
    articleDirectory: string,
    input: Record<string, unknown>,
  ) => Promise<unknown>;
  importRemoteAsset: (
    articleDirectory: string,
    sourceUrl: string,
    options: Record<string, unknown>,
  ) => Promise<unknown>;
  scanArticleAssets: (
    articleDirectory: string,
    options?: Record<string, unknown>,
  ) => Promise<unknown>;
  optimizeArticleAssets: (
    articleDirectory: string,
    options?: Record<string, unknown>,
  ) => Promise<unknown>;
  updateAssetRights: (
    articleDirectory: string,
    assetId: string,
    update: Record<string, unknown>,
  ) => Promise<unknown>;
}

// Keep Electron's CommonJS output compatible with the ESM-only core package.
// This is still the exact @mpforge/media package used by CLI/backend.
const importEsm = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<MediaModule>;

let mediaPromise: Promise<MediaModule> | null = null;
function media(): Promise<MediaModule> {
  mediaPromise ??= importEsm("@mpforge/media");
  return mediaPromise;
}

function requiredActor(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[\p{L}\p{N}_.@ -]{1,100}$/u.test(value.trim())
  ) {
    throw new Error("INVALID_ACTOR: A local human actor is required.");
  }
  return value.trim();
}

function optionalText(
  value: unknown,
  field: string,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 500 || value.includes("\0")) {
    throw new Error(`INVALID_${field.toUpperCase()}: Invalid asset metadata.`);
  }
  return value.trim();
}

function safeError(error: unknown): {
  success: false;
  code: string;
  error: string;
} {
  const candidate = error as { code?: unknown; message?: unknown };
  const message =
    typeof candidate?.message === "string"
      ? candidate.message.replace(/[\r\n]+/g, " ").slice(0, 500)
      : "Asset operation failed.";
  const code =
    typeof candidate?.code === "string" &&
    /^[A-Z0-9_]{2,80}$/.test(candidate.code)
      ? candidate.code
      : (/^([A-Z0-9_]{2,80}):/.exec(message)?.[1] ?? "ASSET_OPERATION_FAILED");
  return { success: false, code, error: message };
}

function metadata(payload: AssetMetadataPayload): Record<string, unknown> {
  const sourceType = payload.sourceType ?? "local";
  if (
    !["local", "generated", "user_owned", "project_asset"].includes(sourceType)
  ) {
    throw new Error("INVALID_SOURCE_TYPE: Local import cannot be remote.");
  }
  if (sourceType === "user_owned" && payload.userOwnedConfirmed !== true) {
    throw new Error(
      "USER_OWNERSHIP_UNCONFIRMED: Confirm user ownership before import.",
    );
  }
  if (sourceType === "generated" && !payload.generationMethod?.trim()) {
    throw new Error(
      "GENERATION_METHOD_REQUIRED: Record how the image was generated.",
    );
  }
  return {
    importedBy: requiredActor(payload.importedBy),
    sourceType,
    rightsStatus: "pending",
    license: optionalText(payload.license, "license"),
    creator: optionalText(payload.creator, "creator"),
    attribution: optionalText(payload.attribution, "attribution"),
    ...(sourceType === "user_owned" ? { userOwnedConfirmed: true } : {}),
    ...(sourceType === "generated"
      ? { generationMethod: payload.generationMethod!.trim() }
      : {}),
  };
}

export function registerAssetHandlers(
  getWindow: () => BrowserWindow | null,
): void {
  ipcMain.handle(
    "assets:list-files",
    async (_event: IpcMainInvokeEvent, payload: AssetActionPayload) => {
      try {
        const directory = resolveWorkspaceArticleDirectory(
          payload?.articlePath,
        );
        return {
          success: true,
          result: await listArticleAssetFiles(directory),
        };
      } catch (error) {
        return safeError(error);
      }
    },
  );

  ipcMain.handle(
    "assets:import-local",
    async (_event: IpcMainInvokeEvent, payload: LocalImportPayload) => {
      try {
        const mainWindow = getWindow();
        if (!mainWindow)
          throw new Error("WINDOW_UNAVAILABLE: Desktop window is unavailable.");
        const articleDirectory = resolveWorkspaceArticleDirectory(
          payload?.articlePath,
        );
        const selected = await dialog.showOpenDialog(mainWindow, {
          title: "显式导入本地图片",
          properties: ["openFile"],
          filters: [
            {
              name: "Images",
              extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"],
            },
          ],
        });
        if (selected.canceled || selected.filePaths.length !== 1) {
          return { success: false, canceled: true, code: "IMPORT_CANCELLED" };
        }
        const selectedPath = selected.filePaths[0];
        const core = await media();
        const result = await core.importAssetBytes(articleDirectory, {
          originalReference: `selected:${path.basename(selectedPath)}`,
          fileName: path.basename(selectedPath),
          data: await readFile(selectedPath),
          metadata: metadata(payload),
        });
        return { success: true, result };
      } catch (error) {
        return safeError(error);
      }
    },
  );

  ipcMain.handle(
    "assets:import-remote",
    async (_event: IpcMainInvokeEvent, payload: RemoteImportPayload) => {
      try {
        if (payload?.rightsAcknowledged !== true) {
          throw new Error(
            "RIGHTS_ACKNOWLEDGEMENT_REQUIRED: Explicit acknowledgement is required.",
          );
        }
        const articleDirectory = resolveWorkspaceArticleDirectory(
          payload.articlePath,
        );
        const core = await media();
        const result = await core.importRemoteAsset(
          articleDirectory,
          payload.sourceUrl,
          {
            importedBy: requiredActor(payload.importedBy),
            rightsAcknowledged: true,
            license: optionalText(payload.license, "license"),
            creator: optionalText(payload.creator, "creator"),
            attribution: optionalText(payload.attribution, "attribution"),
          },
        );
        return { success: true, result };
      } catch (error) {
        return safeError(error);
      }
    },
  );

  ipcMain.handle(
    "assets:scan",
    async (_event: IpcMainInvokeEvent, payload: AssetActionPayload) => {
      try {
        const directory = resolveWorkspaceArticleDirectory(
          payload?.articlePath,
        );
        const result = await (
          await media()
        ).scanArticleAssets(directory, { createManifest: true });
        return { success: true, result };
      } catch (error) {
        return safeError(error);
      }
    },
  );

  ipcMain.handle(
    "assets:optimize",
    async (_event: IpcMainInvokeEvent, payload: AssetActionPayload) => {
      try {
        const directory = resolveWorkspaceArticleDirectory(
          payload?.articlePath,
        );
        const result = await (
          await media()
        ).optimizeArticleAssets(directory, {
          forceReencode: true,
        });
        return { success: true, result };
      } catch (error) {
        return safeError(error);
      }
    },
  );

  ipcMain.handle(
    "assets:update-rights",
    async (_event: IpcMainInvokeEvent, payload: RightsPayload) => {
      try {
        const directory = resolveWorkspaceArticleDirectory(
          payload?.articlePath,
        );
        if (
          !["approved", "pending", "blocked", "unknown"].includes(
            payload.rightsStatus,
          )
        ) {
          throw new Error("INVALID_RIGHTS_STATUS: Unsupported rights status.");
        }
        const result = await (
          await media()
        ).updateAssetRights(directory, payload.assetId, {
          rightsStatus: payload.rightsStatus,
          ...(payload.rightsStatus === "approved" &&
          payload.confirmedByHuman === true
            ? { confirmedByHuman: true }
            : {}),
          ...(payload.userOwnedConfirmed === true
            ? { userOwnedConfirmed: true }
            : {}),
          license: optionalText(payload.license, "license"),
          creator: optionalText(payload.creator, "creator"),
          attribution: optionalText(payload.attribution, "attribution"),
        });
        return { success: true, result };
      } catch (error) {
        return safeError(error);
      }
    },
  );
}
