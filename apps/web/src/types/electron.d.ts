interface ElectronAPI {
  isElectron: boolean;
  platform: string;
  fs: {
    selectWorkspace: () => Promise<{
      success: boolean;
      path?: string;
      canceled?: boolean;
    }>;
    setWorkspace: (
      dir: string,
    ) => Promise<{ success: boolean; path?: string; error?: string }>;
    listFiles: (
      dir?: string,
    ) => Promise<{ success: boolean; files?: unknown[]; error?: string }>;
    readFile: (
      filePath: string,
    ) => Promise<{ success: boolean; content?: string; error?: string }>;
    createFile: (payload: { filename?: string; content?: string }) => Promise<{
      success: boolean;
      filePath?: string;
      filename?: string;
      error?: string;
    }>;
    saveFile: (payload: {
      filePath: string;
      content: string;
      expectedContent?: string;
    }) => Promise<{ success: boolean; error?: string }>;
    renameFile: (payload: {
      oldPath: string;
      newName: string;
    }) => Promise<{ success: boolean; filePath?: string; error?: string }>;
    deleteFile: (
      filePath: string,
    ) => Promise<{ success: boolean; error?: string }>;
    revealInFinder: (filePath: string) => Promise<void>;
    createFolder: (folderName: string) => Promise<{
      success: boolean;
      path?: string;
      name?: string;
      error?: string;
    }>;
    moveFile: (payload: {
      filePath: string;
      targetFolder: string;
    }) => Promise<{ success: boolean; newPath?: string; error?: string }>;
    inspectFolder: (
      folderPath: string,
    ) => Promise<{ success: boolean; entries?: string[]; error?: string }>;
    deleteFolder: (
      payload: string | { folderPath: string; recursive?: boolean },
    ) => Promise<{ success: boolean; error?: string }>;
    renameFolder: (payload: {
      folderPath: string;
      newName: string;
    }) => Promise<{ success: boolean; newPath?: string; error?: string }>;
    moveFolder: (payload: {
      folderPath: string;
      targetFolder: string;
    }) => Promise<{ success: boolean; newPath?: string; error?: string }>;
    readThemes: () => Promise<{
      success: boolean;
      content?: string | null;
      error?: string;
    }>;
    writeThemes: (
      content: string,
    ) => Promise<{ success: boolean; error?: string }>;
    onRefresh: (callback: () => void) => unknown;
    removeRefreshListener: (handler: unknown) => void;
    onMenuNewFile: (callback: () => void) => unknown;
    onMenuSave: (callback: () => void) => unknown;
    onMenuSwitchWorkspace: (callback: () => void) => unknown;
    removeAllListeners: () => void;
  };
  window?: {
    minimize: () => Promise<void>;
    maximize: () => Promise<void>;
    close: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
  };
  shell?: {
    openExternal: (url: string) => Promise<void>;
  };
  clipboard?: {
    writeHTML: (payload: {
      html: string;
      text: string;
    }) => Promise<{ success: boolean; error?: string }>;
    writeText: (text: string) => Promise<{ success: boolean; error?: string }>;
  };
  assets?: {
    listFiles: (payload: {
      articlePath: string;
    }) => Promise<AssetOperationResponse>;
    importLocal: (
      payload: AssetLocalImportRequest,
    ) => Promise<AssetOperationResponse>;
    importRemote: (
      payload: AssetRemoteImportRequest,
    ) => Promise<AssetOperationResponse>;
    scan: (payload: { articlePath: string }) => Promise<AssetOperationResponse>;
    optimize: (payload: {
      articlePath: string;
    }) => Promise<AssetOperationResponse>;
    updateRights: (
      payload: AssetRightsRequest,
    ) => Promise<AssetOperationResponse>;
  };
  review?: {
    loadPreview: (payload: { articlePath: string }) => Promise<{
      success: boolean;
      result?: {
        report: Record<string, unknown>;
        screenshots: Array<{ name: string; sha256: string; dataUrl: string }>;
      };
      error?: string;
    }>;
  };
  round3?: {
    listAccounts: () => Promise<Record<string, unknown>>;
    doctorAccount: (payload: {
      alias: string;
    }) => Promise<Record<string, unknown>>;
    listOperations: () => Promise<Record<string, unknown>>;
    getOperation: (payload: {
      operationId: string;
    }) => Promise<Record<string, unknown>>;
    getMockState: (payload: {
      accountAlias: string;
    }) => Promise<Record<string, unknown>>;
    prepareMock: (payload: {
      slug: string;
      accountAlias: string;
    }) => Promise<Record<string, unknown>>;
    executeMock: (payload: {
      operationId: string;
      fault?: string;
    }) => Promise<Record<string, unknown>>;
    reconcileMock: (payload: {
      operationId: string;
    }) => Promise<Record<string, unknown>>;
    requestReal: (payload: {
      operationId: string;
      requestedBy: string;
    }) => Promise<Record<string, unknown>>;
  };
}

interface AssetOperationResponse {
  success: boolean;
  canceled?: boolean;
  code?: string;
  error?: string;
  result?: unknown;
}

interface AssetMetadataRequest {
  articlePath: string;
  importedBy: string;
  license?: string | null;
  creator?: string | null;
  attribution?: string | null;
}

interface AssetLocalImportRequest extends AssetMetadataRequest {
  sourceType?: "local" | "generated" | "user_owned" | "project_asset";
  generationMethod?: string;
  userOwnedConfirmed?: boolean;
}

interface AssetRemoteImportRequest extends AssetMetadataRequest {
  sourceUrl: string;
  rightsAcknowledged: boolean;
}

interface AssetRightsRequest {
  articlePath: string;
  assetId: string;
  rightsStatus: "approved" | "pending" | "blocked" | "unknown";
  confirmedByHuman?: boolean;
  userOwnedConfirmed?: boolean;
  license?: string | null;
  creator?: string | null;
  attribution?: string | null;
}

declare global {
  interface Window {
    electron?: ElectronAPI;
  }
}

export {};
