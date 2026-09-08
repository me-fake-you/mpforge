import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const mocked = vi.hoisted(() => ({ streamChatCompletion: vi.fn() }));

vi.mock("../../services/ai/aiClient", async () => {
  const actual = await vi.importActual<
    typeof import("../../services/ai/aiClient")
  >("../../services/ai/aiClient");
  return { ...actual, streamChatCompletion: mocked.streamChatCompletion };
});

import { AiRequestError } from "../../services/ai/aiClient";
import { useOptimizeRun } from "../../components/Editor/AiOptimize/useOptimizeRun";

const messages = [{ role: "user" as const, content: "正文" }];
const identity = (raw: string) => raw;

describe("useOptimizeRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, String(value)),
    });
  });

  it("被顶替的旧运行不得把新运行的状态刷回 idle", async () => {
    let rejectFirst: ((error: unknown) => void) | undefined;
    mocked.streamChatCompletion
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectFirst = reject;
          }),
      )
      .mockImplementationOnce(() => new Promise(() => {}));

    const { result } = renderHook(() => useOptimizeRun(identity));

    await act(async () => {
      void result.current.start(messages);
    });
    await act(async () => {
      void result.current.start(messages);
    });

    await act(async () => {
      rejectFirst?.(new AiRequestError("aborted", "已取消"));
      await Promise.resolve();
    });

    expect(result.current.state.name).toBe("running");
  });

  it("当前运行被取消时回到 idle", async () => {
    let rejectRun: ((error: unknown) => void) | undefined;
    mocked.streamChatCompletion.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectRun = reject;
        }),
    );

    const { result } = renderHook(() => useOptimizeRun(identity));
    await act(async () => {
      void result.current.start(messages);
    });
    expect(result.current.state.name).toBe("running");

    await act(async () => {
      rejectRun?.(new AiRequestError("aborted", "已取消"));
      await Promise.resolve();
    });
    expect(result.current.state.name).toBe("idle");
  });

  it("完成后进入 done 并带上原始输出", async () => {
    mocked.streamChatCompletion.mockImplementation(
      async (options: { onDelta?: (delta: string) => void }) => {
        options.onDelta?.("片段");
        return "片段";
      },
    );

    const { result } = renderHook(() => useOptimizeRun(identity));
    await act(async () => {
      await result.current.start(messages);
    });

    await waitFor(() => expect(result.current.state.name).toBe("done"));
    if (result.current.state.name !== "done") return;
    expect(result.current.state.raw).toBe("片段");
  });

  it("失败时按 kind 决定是否给出设置入口", async () => {
    mocked.streamChatCompletion.mockRejectedValue(
      new AiRequestError("rate_limit", "请求过于频繁", 429),
    );

    const { result } = renderHook(() => useOptimizeRun(identity));
    await act(async () => {
      await result.current.start(messages);
    });

    await waitFor(() => expect(result.current.state.name).toBe("error"));
    if (result.current.state.name !== "error") return;
    expect(result.current.state.showSettingsLink).toBe(false);
  });
});
