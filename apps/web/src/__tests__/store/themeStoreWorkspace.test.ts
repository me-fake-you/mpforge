import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useThemeStore } from "../../store/themeStore";
import { saveMirrorThemes } from "../../store/themePersistence";
import type {
  WorkspaceThemeBackend,
  WorkspaceThemeFile,
} from "../../services/theme/themeStorageBackend";
import type { CustomTheme } from "../../store/themes/builtInThemes";

vi.mock("react-hot-toast", () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

const buildTheme = (id: string): CustomTheme => ({
  id,
  name: id,
  css: `#wemd { --id: ${id}; }`,
  isBuiltIn: false,
  createdAt: "2026-07-31T00:00:00.000Z",
  updatedAt: "2026-07-31T00:00:00.000Z",
  editorMode: "css",
});

const createBackend = (initial: WorkspaceThemeFile | null) => {
  let file = initial;
  return {
    read: vi.fn(async () => file),
    write: vi.fn(async (data: WorkspaceThemeFile) => {
      file = data;
    }),
    current: () => file,
  } satisfies WorkspaceThemeBackend & { current: () => typeof file };
};

const resetStore = () => {
  useThemeStore.setState({
    themeId: "default",
    themeName: "默认主题",
    customCSS: "",
    customThemes: [],
    workspaceBackend: null,
    workspaceId: null,
    pendingLocalOnlyThemes: [],
    workspaceFileBroken: false,
  });
};

describe("themeStore 工作区接入", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        values.set(key, String(value));
      }),
    });
    resetStore();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("加载后用文件夹主题替换内存列表", async () => {
    const backend = createBackend({
      version: 1,
      workspaceId: "w1",
      themes: [buildTheme("remote")],
    });

    useThemeStore.getState().setWorkspaceThemeBackend(backend);
    await useThemeStore.getState().loadWorkspaceThemes();

    expect(useThemeStore.getState().customThemes.map((t) => t.id)).toEqual([
      "remote",
    ]);
    expect(useThemeStore.getState().workspaceId).toBe("w1");
  });

  it("当前主题不在新工作区时回落默认主题", async () => {
    useThemeStore.setState({
      themeId: "custom-old",
      themeName: "旧主题",
      customCSS: "#wemd { color: red; }",
    });
    const backend = createBackend({
      version: 1,
      workspaceId: "w1",
      themes: [buildTheme("remote")],
    });

    useThemeStore.getState().setWorkspaceThemeBackend(backend);
    await useThemeStore.getState().loadWorkspaceThemes();

    expect(useThemeStore.getState().themeId).toBe("default");
    expect(useThemeStore.getState().customCSS).toBe("");
  });

  it("当前主题仍存在时保持选中不变", async () => {
    useThemeStore.setState({ themeId: "remote", themeName: "remote" });
    const backend = createBackend({
      version: 1,
      workspaceId: "w1",
      themes: [buildTheme("remote")],
    });

    useThemeStore.getState().setWorkspaceThemeBackend(backend);
    await useThemeStore.getState().loadWorkspaceThemes();

    expect(useThemeStore.getState().themeId).toBe("remote");
  });

  it("新建主题同步写入文件夹，且保持同步返回", async () => {
    const backend = createBackend(null);
    useThemeStore.getState().setWorkspaceThemeBackend(backend);
    await useThemeStore.getState().loadWorkspaceThemes();

    const created = useThemeStore
      .getState()
      .createTheme("新主题", "css", "#wemd { color: red; }");

    expect(created.id).toBeTruthy();
    expect(useThemeStore.getState().customThemes).toHaveLength(1);
    await vi.waitFor(() =>
      expect(backend.current()?.themes.map((t) => t.name)).toEqual(["新主题"]),
    );
  });

  it("删除主题后文件夹内容同步移除", async () => {
    const backend = createBackend({
      version: 1,
      workspaceId: "w1",
      themes: [buildTheme("remote")],
    });
    useThemeStore.getState().setWorkspaceThemeBackend(backend);
    await useThemeStore.getState().loadWorkspaceThemes();

    useThemeStore.getState().deleteTheme("remote");

    await vi.waitFor(() => expect(backend.current()?.themes).toEqual([]));
  });

  it("首次写入使用读取完成时的最新主题，不覆盖读取期间新建的主题", async () => {
    saveMirrorThemes([buildTheme("mirror")]);
    let releaseRead!: () => void;
    const pendingRead = new Promise<null>((resolve) => {
      releaseRead = () => resolve(null);
    });
    const backend = {
      read: vi.fn(async () => pendingRead),
      write: vi.fn(async (_data: WorkspaceThemeFile) => undefined),
    } satisfies WorkspaceThemeBackend;

    useThemeStore.setState({ customThemes: [buildTheme("mirror")] });
    useThemeStore.getState().setWorkspaceThemeBackend(backend);
    const loading = useThemeStore.getState().loadWorkspaceThemes();

    // 读取尚未完成时新建主题
    useThemeStore.getState().createTheme("读取期间新建", "css", "#wemd {}");
    releaseRead();
    await loading;

    const written = backend.write.mock.calls.at(-1)?.[0];
    expect(written?.themes.map((t) => t.name)).toContain("读取期间新建");
    expect(written?.themes.map((t) => t.id)).toContain("mirror");
  });

  it("首次保存主题时生成并回填 workspaceId", async () => {
    const backend = createBackend(null);
    useThemeStore.getState().setWorkspaceThemeBackend(backend);
    await useThemeStore.getState().loadWorkspaceThemes();
    expect(useThemeStore.getState().workspaceId).toBeNull();

    useThemeStore.getState().createTheme("第一个主题", "css", "#wemd {}");
    const generatedId = useThemeStore.getState().workspaceId;
    expect(generatedId).toBeTruthy();

    // 后续写入复用同一个 id，避免每次写入都换标识
    useThemeStore.getState().createTheme("第二个主题", "css", "#wemd {}");
    expect(useThemeStore.getState().workspaceId).toBe(generatedId);
    await vi.waitFor(() =>
      expect(backend.current()?.workspaceId).toBe(generatedId),
    );
  });

  it("暂缓处理时下次仍会询问，明确拒绝后不再询问", async () => {
    saveMirrorThemes([buildTheme("local")]);
    const backend = createBackend({
      version: 1,
      workspaceId: "w1",
      themes: [buildTheme("remote")],
    });
    useThemeStore.getState().setWorkspaceThemeBackend(backend);

    await useThemeStore.getState().loadWorkspaceThemes();
    expect(
      useThemeStore.getState().pendingLocalOnlyThemes.map((t) => t.id),
    ).toEqual(["local"]);

    // Esc 关闭：不记住，重新加载仍会询问
    useThemeStore.getState().snoozePendingThemes();
    await useThemeStore.getState().loadWorkspaceThemes();
    expect(
      useThemeStore.getState().pendingLocalOnlyThemes.map((t) => t.id),
    ).toEqual(["local"]);

    // 明确选择不加入：记住，重新加载不再询问
    useThemeStore.getState().dismissPendingThemes();
    await useThemeStore.getState().loadWorkspaceThemes();
    expect(useThemeStore.getState().pendingLocalOnlyThemes).toEqual([]);
  });

  it("目标主题已不存在时报错而不是静默返回", async () => {
    const toast = (await import("react-hot-toast")).default;

    useThemeStore.getState().updateTheme("missing", { name: "x" });

    expect(toast.error).toHaveBeenCalled();
  });

  it("选择加入后把本机独有的主题写入文件夹", async () => {
    const backend = createBackend({
      version: 1,
      workspaceId: "w1",
      themes: [buildTheme("remote")],
    });
    useThemeStore.setState({
      workspaceBackend: backend,
      workspaceId: "w1",
      customThemes: [buildTheme("remote")],
      pendingLocalOnlyThemes: [buildTheme("local")],
    });

    useThemeStore.getState().acceptPendingThemes();

    expect(useThemeStore.getState().pendingLocalOnlyThemes).toEqual([]);
    await vi.waitFor(() =>
      expect(backend.current()?.themes.map((t) => t.id)).toEqual([
        "remote",
        "local",
      ]),
    );
  });

  it("读取失败时保留内存主题，不覆盖写回", async () => {
    const backend: WorkspaceThemeBackend = {
      read: vi.fn(async () => {
        throw new Error("broken");
      }),
      write: vi.fn(),
    };
    useThemeStore.setState({ customThemes: [buildTheme("local")] });

    useThemeStore.getState().setWorkspaceThemeBackend(backend);
    await useThemeStore.getState().loadWorkspaceThemes();

    expect(useThemeStore.getState().customThemes.map((t) => t.id)).toEqual([
      "local",
    ]);
    expect(backend.write).not.toHaveBeenCalled();
  });

  it("文件损坏后保存主题只更新镜像，不覆盖损坏文件", async () => {
    const backend: WorkspaceThemeBackend = {
      read: vi.fn(async () => {
        throw new Error("broken");
      }),
      write: vi.fn(async () => undefined),
    };
    useThemeStore.setState({ customThemes: [buildTheme("local")] });

    useThemeStore.getState().setWorkspaceThemeBackend(backend);
    await useThemeStore.getState().loadWorkspaceThemes();
    expect(useThemeStore.getState().workspaceFileBroken).toBe(true);

    // 损坏期间保存：只写镜像，不触碰损坏文件
    useThemeStore.getState().createTheme("损坏后新建", "css", "#wemd {}");
    expect(backend.write).not.toHaveBeenCalled();
    expect(useThemeStore.getState().customThemes.map((t) => t.name)).toContain(
      "损坏后新建",
    );

    // 重新加载成功（文件已修复）后恢复写入
    useThemeStore.setState({ workspaceFileBroken: false });
    useThemeStore.getState().createTheme("恢复后新建", "css", "#wemd {}");
    await vi.waitFor(() => expect(backend.write).toHaveBeenCalled());
    const written = vi.mocked(backend.write).mock.calls.at(-1)?.[0];
    expect(written?.workspaceId).toBeTruthy();
  });

  it("删除不存在的主题时报错而不是静默返回", async () => {
    const toast = (await import("react-hot-toast")).default;

    useThemeStore.getState().deleteTheme("missing");

    expect(toast.error).toHaveBeenCalled();
  });
});
