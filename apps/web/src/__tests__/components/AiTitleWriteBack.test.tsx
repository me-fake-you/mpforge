import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const mocked = vi.hoisted(() => ({
  streamChatCompletion: vi.fn(),
  updateFileTitle: vi.fn(),
  updateTitle: vi.fn(),
  saveSnapshot: vi.fn(),
  storageType: { value: "indexeddb" },
  currentFile: { value: null as { path: string } | null },
}));

vi.mock("../../services/ai/aiClient", async () => {
  const actual = await vi.importActual<
    typeof import("../../services/ai/aiClient")
  >("../../services/ai/aiClient");
  return { ...actual, streamChatCompletion: mocked.streamChatCompletion };
});

vi.mock("../../services/ai/aiConfig", async () => {
  const actual = await vi.importActual<
    typeof import("../../services/ai/aiConfig")
  >("../../services/ai/aiConfig");
  return { ...actual, isAiRewriteReady: () => true };
});

vi.mock("../../hooks/useFileSystem", () => ({
  useFileSystem: () => ({
    currentFile: mocked.currentFile.value,
    files: [{ name: "a.md", path: "/w/a.md", title: "新文章" }],
    flattenFiles: (files: unknown[]) => files,
    updateFileTitle: mocked.updateFileTitle,
  }),
}));

vi.mock("../../storage/StorageContext", () => ({
  useStorageContext: () => ({ type: mocked.storageType.value }),
}));

import { AiOptimizeButtons } from "../../components/Editor/AiOptimize/AiOptimizeButtons";
import { useEditorStore } from "../../store/editorStore";
import { useHistoryStore } from "../../store/historyStore";

const TITLES = [
  "直给|5 个细节决定读者读不读完",
  "疑问|你的排版差在哪？",
  "PICK|直给|直接给方法",
].join("\n");

function stubStorage() {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, String(value)),
  });
}

async function pickFirstTitle() {
  render(<AiOptimizeButtons />);
  fireEvent.click(screen.getByLabelText("起标题"));
  await waitFor(() =>
    expect(
      document.querySelectorAll(".ai-title-option").length,
    ).toBeGreaterThan(0),
  );
  fireEvent.click(document.querySelectorAll(".ai-title-option")[0]);
  fireEvent.click(screen.getByRole("button", { name: /用作标题|替换标题/ }));
}

describe("起标题写回", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubStorage();
    mocked.streamChatCompletion.mockImplementation(
      async (options: { onDelta?: (d: string) => void }) => {
        act(() => options.onDelta?.(TITLES));
        return TITLES;
      },
    );
    useEditorStore.setState({ markdown: "用于拟标题的正文" });
    useHistoryStore.setState({
      history: [{ id: "h1", title: "新文章" }],
      activeId: "h1",
      updateTitle: mocked.updateTitle,
      saveSnapshot: mocked.saveSnapshot,
    } as never);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("历史记录模式写回 historyStore", async () => {
    mocked.storageType.value = "indexeddb";
    mocked.currentFile.value = null;

    await pickFirstTitle();

    expect(mocked.updateTitle).toHaveBeenCalledWith(
      "h1",
      "5 个细节决定读者读不读完",
    );
    expect(mocked.updateFileTitle).not.toHaveBeenCalled();
  });

  it("文件模式写回文件标题，不去动 historyStore", async () => {
    mocked.storageType.value = "filesystem";
    mocked.currentFile.value = { path: "/w/a.md" };

    await pickFirstTitle();

    expect(mocked.updateFileTitle).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/w/a.md" }),
      "5 个细节决定读者读不读完",
    );
    expect(mocked.updateTitle).not.toHaveBeenCalled();
  });

  it("文件模式下没有打开文件时如实提示，不静默失败", async () => {
    mocked.storageType.value = "filesystem";
    mocked.currentFile.value = null;

    await pickFirstTitle();

    expect(mocked.updateFileTitle).not.toHaveBeenCalled();
    expect(mocked.updateTitle).not.toHaveBeenCalled();
  });

  it("同一正文再次打开复用候选，正文变化才重新生成", async () => {
    render(<AiOptimizeButtons />);
    const titleButton = screen.getByLabelText("起标题");

    fireEvent.click(titleButton);
    await waitFor(() =>
      expect(mocked.streamChatCompletion).toHaveBeenCalledTimes(1),
    );

    fireEvent.click(titleButton);
    fireEvent.click(titleButton);
    expect(mocked.streamChatCompletion).toHaveBeenCalledTimes(1);

    fireEvent.click(titleButton);
    act(() => useEditorStore.getState().setMarkdown("修改后的正文"));
    fireEvent.click(titleButton);
    await waitFor(() =>
      expect(mocked.streamChatCompletion).toHaveBeenCalledTimes(2),
    );
  });
});
