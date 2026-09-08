import { useCallback, useEffect, useRef, useState } from "react";

import {
  AiRequestError,
  streamChatCompletion,
  type AiMessage,
} from "../../../services/ai/aiClient";
import { getAiConfig } from "../../../services/ai/aiConfig";
import {
  beginAiRequest,
  type AiRequestLease,
} from "../../../services/ai/aiRequestCoordinator";

export type OptimizeState<T> =
  | { name: "idle" }
  | { name: "running"; parsed: T; raw: string; thinking: boolean }
  | { name: "done"; parsed: T; raw: string }
  | { name: "error"; message: string; showSettingsLink: boolean };

const SETTINGS_ERROR_KINDS = new Set([
  "auth",
  "bad_request",
  "network",
  "timeout",
]);

export function useOptimizeRun<T>(parse: (raw: string) => T) {
  const [state, setState] = useState<OptimizeState<T>>({ name: "idle" });
  const [reasoning, setReasoning] = useState("");
  const [thinkingMs, setThinkingMs] = useState(0);
  const thinkStartRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const leaseRef = useRef<AiRequestLease | null>(null);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      leaseRef.current?.release();
    },
    [],
  );

  const start = useCallback(
    async (messages: AiMessage[]) => {
      abortRef.current?.abort();
      leaseRef.current?.release();
      const lease = beginAiRequest();
      const controller = lease.controller;
      leaseRef.current = lease;
      abortRef.current = controller;

      let raw = "";
      setReasoning("");
      setThinkingMs(0);
      thinkStartRef.current = 0;
      // 被顶替的旧运行不许再改状态：它的 abort 异常会晚于新运行的
      // setState 落地，否则会把刚开始的 running 刷回 idle
      const isCurrent = () =>
        abortRef.current === controller && lease.isCurrent();
      const stillOwned = () => abortRef.current === controller;
      setState({
        name: "running",
        parsed: parse(""),
        raw: "",
        thinking: false,
      });

      try {
        await streamChatCompletion({
          config: getAiConfig(),
          messages,
          signal: controller.signal,
          onReasoning: (delta) => {
            if (!isCurrent()) return;
            if (!thinkStartRef.current) thinkStartRef.current = Date.now();
            setThinkingMs(Date.now() - thinkStartRef.current);
            setReasoning((prev) => prev + delta);
            setState((prev) =>
              prev.name === "running" && !prev.thinking
                ? { ...prev, thinking: true }
                : prev,
            );
          },
          onDelta: (delta) => {
            // 正文一来就说明思考结束，冻住耗时
            if (thinkStartRef.current) {
              setThinkingMs(Date.now() - thinkStartRef.current);
              thinkStartRef.current = 0;
            }
            raw += delta;
            if (!isCurrent()) return;
            const parsed = parse(raw);
            const snapshot = raw;
            setState((prev) =>
              prev.name === "running"
                ? { name: "running", parsed, raw: snapshot, thinking: false }
                : prev,
            );
          },
        });
        if (!isCurrent()) return;
        setState({ name: "done", parsed: parse(raw), raw });
      } catch (error) {
        // 全局协调器取消了本请求时，仍要把本面板从 running 收回 idle；
        // 但同一面板已经启动新请求时，旧请求不能碰新状态。
        if (!stillOwned()) return;
        if (error instanceof AiRequestError && error.kind === "aborted") {
          setState({ name: "idle" });
          return;
        }
        const failure =
          error instanceof AiRequestError
            ? error
            : new AiRequestError("network", "请求失败，请稍后重试");
        setState({
          name: "error",
          message: failure.message,
          showSettingsLink: SETTINGS_ERROR_KINDS.has(failure.kind),
        });
      }
    },
    [parse],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    leaseRef.current?.release();
    setState({ name: "idle" });
  }, []);

  return { state, reasoning, thinkingMs, start, cancel };
}
