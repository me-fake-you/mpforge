import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildArticleDocument,
  parseArticleDocument,
} from "@mpforge/content-schema";
import { useFileSystemEffects } from "../../hooks/useFileSystemEffects";
import type { ElectronAPI } from "../../hooks/useFileSystemHelpers";
import { useActiveFilePersistence } from "../../hooks/useActiveFilePersistence";
import type { StorageAdapter } from "../../storage/StorageAdapter";
import { useEditorStore } from "../../store/editorStore";
import { useFileStore } from "../../store/fileStore";
import { useThemeStore } from "../../store/themeStore";

const articlePath = "content/round1-autosave/article.md";
const initialSource = buildArticleDocument(
  {
    id: "round1-autosave",
    slug: "round1-autosave",
    title: "自动保存",
    summary: "",
    author: "MPForge QA",
    account: "local-test",
    theme: "minimal",
    status: "draft",
    created_at: "2026-08-31T00:00:00.000Z",
    updated_at: "2026-08-31T00:00:00.000Z",
  },
  "# 旧正文\n",
);

function currentFile() {
  return {
    name: "article.md",
    path: articlePath,
    title: "自动保存",
    createdAt: new Date("2026-08-31T00:00:00.000Z"),
    updatedAt: new Date("2026-08-31T00:00:00.000Z"),
    size: initialSource.length,
  };
}

describe("Round 1 autosave integration", () => {
  beforeEach(() => {
    useFileStore.setState({
      currentFile: currentFile(),
      lastSavedContent: initialSource,
      lastSavedAt: null,
      isDirty: true,
      isSaving: false,
      isRestoring: false,
    });
    useEditorStore.setState({ markdown: "# 自动保存后的正文\n" });
    useThemeStore.setState({
      themeId: "academic-blue",
      themeName: "Academic Blue",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("persists one coherent editor/theme snapshot and clears dirty state", async () => {
    const writeFile = vi.fn<(path: string, content: string) => Promise<void>>(
      async () => undefined,
    );
    const adapter = {
      type: "indexeddb",
      name: "Round 1 memory adapter",
      ready: true,
      init: vi.fn(),
      listFiles: vi.fn(),
      readFile: vi.fn(async () => initialSource),
      writeFile,
      deleteFile: vi.fn(),
      renameFile: vi.fn(),
      exists: vi.fn(),
    } as unknown as StorageAdapter;
    const setters = useFileStore.getState();

    const { result } = renderHook(() =>
      useActiveFilePersistence({
        adapter,
        electron: null,
        storageReady: true,
        setIsDirty: setters.setIsDirty,
        setLastSavedAt: setters.setLastSavedAt,
        setLastSavedContent: setters.setLastSavedContent,
        setSaving: setters.setSaving,
      }),
    );

    await act(async () => {
      expect(await result.current()).toBe(true);
    });

    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(writeFile).toHaveBeenCalledWith(articlePath, expect.any(String));
    const persisted = parseArticleDocument(
      writeFile.mock.calls[0]![1] as string,
    );
    expect(persisted.body).toBe("# 自动保存后的正文\n");
    expect(persisted.frontmatter.theme).toBe("academic-blue");
    expect(useFileStore.getState().isDirty).toBe(false);
    expect(useFileStore.getState().lastSavedAt).toBeInstanceOf(Date);
  });

  it("waits for the editing pause before scheduling autosave", async () => {
    vi.useFakeTimers();
    const saveFile = vi.fn(async () => undefined);
    const noOp = vi.fn();
    const electron = {
      fs: {
        onRefresh: vi.fn(() => "round1-refresh"),
        removeRefreshListener: vi.fn(),
        onMenuNewFile: vi.fn(),
        onMenuSave: vi.fn(),
        onMenuSwitchWorkspace: vi.fn(),
        removeAllListeners: vi.fn(),
      },
    } as unknown as ElectronAPI;

    renderHook(() =>
      useFileSystemEffects({
        enabled: true,
        electron,
        adapter: null,
        storageReady: true,
        storageType: "indexeddb",
        currentFile: currentFile(),
        markdown: "# 自动保存后的正文\n",
        theme: "academic-blue",
        themeName: "Academic Blue",
        isRestoring: false,
        isDirty: true,
        isLoading: false,
        lastSavedContent: initialSource,
        loadWorkspace: vi.fn(async () => undefined),
        refreshFiles: vi.fn(async () => undefined),
        openFile: vi.fn(async () => undefined),
        createFile: vi.fn(async () => undefined),
        saveFile,
        selectWorkspace: vi.fn(async () => undefined),
        setCurrentFile: noOp,
        setMarkdown: noOp,
        setIsDirty: noOp,
        setLastSavedContent: noOp,
        setLoading: noOp,
        setWorkspacePath: noOp,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_999);
    });
    expect(saveFile).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(saveFile).toHaveBeenCalledTimes(1);
  });

  it("does not rewrite an untouched file merely to normalize frontmatter", async () => {
    vi.useFakeTimers();
    const saveFile = vi.fn(async () => undefined);
    const setIsDirty = vi.fn();
    const electron = {
      fs: {
        onRefresh: vi.fn(() => "round1-refresh"),
        removeRefreshListener: vi.fn(),
        onMenuNewFile: vi.fn(),
        onMenuSave: vi.fn(),
        onMenuSwitchWorkspace: vi.fn(),
        removeAllListeners: vi.fn(),
      },
    } as unknown as ElectronAPI;
    const parsed = parseArticleDocument(initialSource);
    useThemeStore.setState({ themeId: "minimal", themeName: "Minimal" });

    renderHook(() =>
      useFileSystemEffects({
        enabled: true,
        electron,
        adapter: null,
        storageReady: true,
        storageType: "indexeddb",
        currentFile: currentFile(),
        markdown: parsed.body,
        theme: "minimal",
        themeName: "Minimal",
        isRestoring: false,
        isDirty: false,
        isLoading: false,
        lastSavedContent: initialSource,
        loadWorkspace: vi.fn(async () => undefined),
        refreshFiles: vi.fn(async () => undefined),
        openFile: vi.fn(async () => undefined),
        createFile: vi.fn(async () => undefined),
        saveFile,
        selectWorkspace: vi.fn(async () => undefined),
        setCurrentFile: vi.fn(),
        setMarkdown: vi.fn(),
        setIsDirty,
        setLastSavedContent: vi.fn(),
        setLoading: vi.fn(),
        setWorkspacePath: vi.fn(),
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_500);
    });

    expect(setIsDirty).not.toHaveBeenCalledWith(true);
    expect(saveFile).not.toHaveBeenCalled();
  });
});
