import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadMirrorThemes,
  loadWorkspaceThemes,
  markWorkspaceReconciled,
  persistThemes,
  saveMirrorThemes,
} from "../../store/themePersistence";
import type {
  WorkspaceThemeBackend,
  WorkspaceThemeFile,
} from "../../services/theme/themeStorageBackend";
import type { CustomTheme } from "../../store/themes/builtInThemes";

vi.mock("react-hot-toast", () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

const buildTheme = (id: string, name = id): CustomTheme => ({
  id,
  name,
  css: `#wemd { --id: ${id}; }`,
  isBuiltIn: false,
  createdAt: "2026-07-31T00:00:00.000Z",
  updatedAt: "2026-07-31T00:00:00.000Z",
  editorMode: "css",
});

const createBackend = (initial: WorkspaceThemeFile | null) => {
  let file = initial;
  const backend: WorkspaceThemeBackend & { current: () => typeof file } = {
    read: vi.fn(async () => file),
    write: vi.fn(async (data: WorkspaceThemeFile) => {
      file = data;
    }),
    current: () => file,
  };
  return backend;
};

describe("工作区主题持久化", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        values.set(key, String(value));
      }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("文件夹没有主题文件时交给调用方写入，自己不写盘", async () => {
    saveMirrorThemes([buildTheme("a")]);
    const backend = createBackend(null);

    const result = await loadWorkspaceThemes(backend);

    expect(result.themes.map((t) => t.id)).toEqual(["a"]);
    expect(result.needsFirstWrite).toBe(true);
    expect(result.pendingLocalOnly).toEqual([]);
    // 首次写入必须回到 store，避免读取期间新建的主题被覆盖
    expect(backend.write).not.toHaveBeenCalled();
  });

  it("本机没有自定义主题时不写文件", async () => {
    const backend = createBackend(null);

    const result = await loadWorkspaceThemes(backend);

    expect(result.themes).toEqual([]);
    expect(result.workspaceId).toBeNull();
    expect(result.needsFirstWrite).toBe(false);
    expect(backend.write).not.toHaveBeenCalled();
  });

  it("丢弃缺少必要字段的主题条目", async () => {
    const backend = createBackend({
      version: 1,
      workspaceId: "w1",
      themes: [
        buildTheme("ok"),
        { id: "broken", name: "坏主题" } as unknown as CustomTheme,
        null as unknown as CustomTheme,
      ],
    });

    const result = await loadWorkspaceThemes(backend);

    expect(result.themes.map((t) => t.id)).toEqual(["ok"]);
  });

  it("文件夹已有主题文件时以文件夹为准", async () => {
    saveMirrorThemes([buildTheme("local")]);
    const backend = createBackend({
      version: 1,
      workspaceId: "w1",
      themes: [buildTheme("remote")],
    });

    const result = await loadWorkspaceThemes(backend);

    expect(result.themes.map((t) => t.id)).toEqual(["remote"]);
    expect(backend.write).not.toHaveBeenCalled();
  });

  it("列出本机独有的主题，等待用户确认", async () => {
    saveMirrorThemes([buildTheme("shared"), buildTheme("local")]);
    const backend = createBackend({
      version: 1,
      workspaceId: "w1",
      themes: [buildTheme("shared")],
    });

    const result = await loadWorkspaceThemes(backend);

    expect(result.pendingLocalOnly.map((t) => t.id)).toEqual(["local"]);
  });

  it("已经比对过的工作区不再重复询问", async () => {
    saveMirrorThemes([buildTheme("local")]);
    markWorkspaceReconciled("w1");
    const backend = createBackend({
      version: 1,
      workspaceId: "w1",
      themes: [],
    });

    const result = await loadWorkspaceThemes(backend);

    expect(result.pendingLocalOnly).toEqual([]);
  });

  it("写入时镜像先行，文件夹随后异步写入", async () => {
    const backend = createBackend(null);
    const themes = [buildTheme("a")];

    persistThemes(themes, backend, "w1");

    expect(loadMirrorThemes().map((t) => t.id)).toEqual(["a"]);
    await vi.waitFor(() => expect(backend.write).toHaveBeenCalledTimes(1));
    expect(backend.current()?.workspaceId).toBe("w1");
  });

  it("文件夹写入失败不影响本机镜像", async () => {
    const backend: WorkspaceThemeBackend = {
      read: vi.fn(async () => null),
      write: vi.fn(async () => {
        throw new Error("permission denied");
      }),
    };
    const toast = (await import("react-hot-toast")).default;

    persistThemes([buildTheme("a")], backend, "w1");

    expect(loadMirrorThemes().map((t) => t.id)).toEqual(["a"]);
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalled());
  });

  it("无后端时只写本机镜像", () => {
    persistThemes([buildTheme("a")], null, null);

    expect(loadMirrorThemes().map((t) => t.id)).toEqual(["a"]);
  });

  it("主题文件损坏时抛错，由调用方保留内存与镜像", async () => {
    const backend: WorkspaceThemeBackend = {
      read: vi.fn(async () => {
        throw new Error("主题文件格式不正确");
      }),
      write: vi.fn(),
    };

    await expect(loadWorkspaceThemes(backend)).rejects.toThrow(
      "主题文件格式不正确",
    );
    expect(backend.write).not.toHaveBeenCalled();
  });
});
