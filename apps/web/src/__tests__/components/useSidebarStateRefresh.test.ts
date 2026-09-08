import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSidebarState } from "../../components/Sidebar/useSidebarState";

const mocks = vi.hoisted(() => {
  const refreshFiles = vi.fn(async () => {});

  return {
    refreshFiles,
    useFileSystemResult: {
      files: [],
      currentFile: null,
      openFile: vi.fn(),
      createFile: vi.fn(),
      updateFileTitle: vi.fn(),
      deleteFile: vi.fn(),
      selectWorkspace: vi.fn(),
      workspacePath: "/workspace",
      workspaceRevision: 0,
      createFolder: vi.fn(),
      moveToFolder: vi.fn(),
      renameFolder: vi.fn(),
      moveFolder: vi.fn(),
      deleteFolder: vi.fn(),
      inspectFolder: vi.fn(async () => []),
      flattenFiles: vi.fn(() => []),
      refreshFiles,
    },
    toast: {
      success: vi.fn(),
      error: vi.fn(),
    },
    localStorage: {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    },
  };
});

vi.mock("../../hooks/useFileSystem", () => ({
  useFileSystem: () => mocks.useFileSystemResult,
}));

vi.mock("react-hot-toast", () => ({
  default: mocks.toast,
}));

describe("useSidebarState 刷新入口", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("localStorage", mocks.localStorage);
    mocks.useFileSystemResult.workspacePath = "/workspace";
    mocks.useFileSystemResult.workspaceRevision = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("会暴露文件系统刷新动作", async () => {
    const { result } = renderHook(() => useSidebarState());

    await act(async () => {
      await result.current.refreshFiles();
    });

    await waitFor(() => {
      expect(mocks.refreshFiles).toHaveBeenCalledTimes(1);
    });
  });

  it("切换工作区时会清理旧工作区的局部状态", async () => {
    const { result, rerender } = renderHook(() => useSidebarState());

    act(() => {
      result.current.setFilter("旧工作区文章");
      result.current.setActiveFolder("/workspace/drafts");
      result.current.setRenamingPath("/workspace/drafts/old.md");
      result.current.setRenameValue("旧标题");
      result.current.setShowNewFolderModal(true);
      result.current.setNewFolderName("旧文件夹");
      result.current.setDraggingPath("/workspace/drafts/old.md");
      result.current.setDraggingFolderPath("/workspace/drafts");
      result.current.setDragOverTarget("/workspace/archive");
    });

    mocks.useFileSystemResult.workspacePath = "/another-workspace";
    rerender();

    await waitFor(() => {
      expect(result.current.filter).toBe("");
      expect(result.current.activeFolder).toBeNull();
      expect(result.current.renamingPath).toBeNull();
      expect(result.current.renameValue).toBe("");
      expect(result.current.showNewFolderModal).toBe(false);
      expect(result.current.newFolderName).toBe("");
      expect(result.current.draggingPath).toBeNull();
      expect(result.current.draggingFolderPath).toBeNull();
      expect(result.current.dragOverTarget).toBeNull();
      expect(mocks.localStorage.setItem).toHaveBeenCalledWith(
        "wemd-folder-collapsed",
        "[]",
      );
    });
  });

  it("切换到同名工作区时也会按修订号清理局部状态", async () => {
    const { result, rerender } = renderHook(() => useSidebarState());

    act(() => {
      result.current.setFilter("旧工作区文章");
      result.current.setActiveFolder("drafts");
    });

    mocks.useFileSystemResult.workspaceRevision = 1;
    rerender();

    await waitFor(() => {
      expect(result.current.filter).toBe("");
      expect(result.current.activeFolder).toBeNull();
    });
  });
});
