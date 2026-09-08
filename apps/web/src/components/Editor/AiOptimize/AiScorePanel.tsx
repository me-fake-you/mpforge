import { useEffect, useRef, useState } from "react";
import { Check, CornerDownRight, Settings2, Undo2 } from "lucide-react";

import {
  getAiConfig,
  requestOpenAiSettings,
} from "../../../services/ai/aiConfig";
import {
  buildScoreMessages,
  parseScoreReport,
  type ScoreDimensionResult,
  type ScoreGrade,
} from "../../../services/ai/aiPrompts";
import { prepareDocument } from "../../../services/ai/aiSelection";
import type { TextRange } from "../../../services/ai/aiLocate";
import type { EditorTextActions } from "../../../store/aiPanelStore";
import { PixelLoader, ThinkingTrace } from "../../common";
import { useOptimizeRun } from "./useOptimizeRun";

const GRADE_TEXT: Record<ScoreGrade, string> = {
  good: "好",
  fair: "一般",
  poor: "待改进",
};

interface AiScorePanelProps {
  markdown: string;
  onClose: () => void;
  editorActions?: EditorTextActions | null;
  /** 换 key 重挂载整块面板；本地状态随之清空，不用逐个手动重置 */
  onRerun: () => void;
  /** 活动请求被其他 AI 面板取消后，重新显示时应重新审阅 */
  onCanceled?: () => void;
  variant?: "popover" | "side";
}

/** 一条建议在本次审阅内的处置状态 */
type FixState =
  | { name: "idle" }
  | { name: "expanded"; located: boolean }
  | {
      name: "applied";
      range: TextRange;
      applied: string;
      original: string;
      revertFailed?: boolean;
    }
  | { name: "dismissed" };

export function AiScorePanel({
  markdown,
  onClose,
  editorActions,
  onRerun,
  onCanceled,
  variant = "popover",
}: AiScorePanelProps) {
  const shell = variant === "side" ? "ai-panel is-side" : "ai-panel";
  const payload = prepareDocument(markdown);
  const { state, reasoning, thinkingMs, start, cancel } =
    useOptimizeRun(parseScoreReport);
  const [fixStates, setFixStates] = useState<Record<string, FixState>>({});
  const startedRef = useRef(false);

  const setFixState = (id: string, next: FixState) =>
    setFixStates((prev) => ({ ...prev, [id]: next }));

  const handleExpand = (dimension: ScoreDimensionResult) => {
    const located = editorActions?.reveal(dimension.quote) ?? false;
    setFixState(dimension.id, { name: "expanded", located });
  };

  const handleAccept = (dimension: ScoreDimensionResult) => {
    const result = editorActions?.applyFix(
      dimension.quote,
      dimension.fix?.replacement ?? "",
    );
    if (!result) {
      setFixState(dimension.id, { name: "expanded", located: false });
      return;
    }
    setFixState(dimension.id, {
      name: "applied",
      range: result.range,
      applied: dimension.fix?.replacement ?? "",
      original: result.original,
    });
  };

  const handleRevert = (
    dimension: ScoreDimensionResult,
    state: Extract<FixState, { name: "applied" }>,
  ) => {
    const ok = editorActions?.revertFix(
      state.range,
      state.applied,
      state.original,
    );
    // 撤销不掉说明这段已被用户自己改过，如实说明，不能收起来当作撤销成功
    setFixState(
      dimension.id,
      ok
        ? { name: "expanded", located: true }
        : { ...state, revertFailed: true },
    );
  };

  useEffect(() => {
    if (state.name === "running") startedRef.current = true;
    if (state.name === "idle" && startedRef.current) {
      startedRef.current = false;
      onCanceled?.();
    }
  }, [onCanceled, state.name]);

  useEffect(() => {
    void start(buildScoreMessages(payload.text, getAiConfig().preference));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state.name === "error") {
    return (
      <div className={shell}>
        <p className="ai-panel-error">{state.message}</p>
        <div className="ai-panel-footer">
          {state.showSettingsLink && (
            <button
              type="button"
              className="ai-panel-link"
              onClick={() => {
                onClose();
                requestOpenAiSettings();
              }}
            >
              <Settings2 size={13} />
              检查设置
            </button>
          )}
          <button type="button" className="ai-panel-btn" onClick={onClose}>
            关闭
          </button>
          <button
            type="button"
            className="ai-panel-btn is-primary"
            onClick={onRerun}
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  const running = state.name === "running";
  // 推理模型思考期间没有正文产出，如实说明在等什么
  const thinking = state.name === "running" && state.thinking;
  const report = state.name === "idle" ? null : state.parsed;
  const raw = state.name === "idle" ? "" : state.raw;
  // 完成但一行都没解析出来：模型没按格式返回，如实说明并把原文交还给用户
  const hasContent =
    payload.truncated ||
    Boolean(report?.top) ||
    (report?.dimensions.length ?? 0) > 0;
  const unparsed =
    state.name === "done" && !report?.top && report?.dimensions.length === 0;

  return (
    <div className={shell}>
      <ThinkingTrace
        text={reasoning}
        active={thinking}
        durationMs={thinkingMs}
      />

      {payload.truncated && (
        <p className="ai-panel-note">
          正文共 {payload.totalChars} 字，仅评估前 {payload.text.length} 字
        </p>
      )}

      {report?.top && (
        <div className="ai-score-top">
          <div className="ai-panel-label">最值得改的一处</div>
          <p>{report.top}</p>
        </div>
      )}

      {report && report.dimensions.length > 0 && (
        <ul className="ai-score-rows">
          {report.dimensions.map((dimension) => {
            const fixState = fixStates[dimension.id] ?? { name: "idle" };
            // 流式期间最后一条可能只收到一半，此时采纳会把残句写进正文
            const canApply = Boolean(
              editorActions && dimension.fix?.replacement && !running,
            );

            return (
              <li key={dimension.id} className="ai-score-row">
                <div className="ai-score-head">
                  <span className="ai-score-name">{dimension.label}</span>
                  {dimension.metric && (
                    <span className="ai-score-metric">{dimension.metric}</span>
                  )}
                  <span className={`ai-score-grade is-${dimension.grade}`}>
                    {GRADE_TEXT[dimension.grade]}
                  </span>
                </div>
                {dimension.quote &&
                  (editorActions ? (
                    <button
                      type="button"
                      className="ai-score-quote is-clickable"
                      onClick={() => handleExpand(dimension)}
                    >
                      「{dimension.quote}」
                    </button>
                  ) : (
                    <p className="ai-score-quote">「{dimension.quote}」</p>
                  ))}

                {dimension.fix && (
                  <div className={`ai-fix is-${fixState.name}`}>
                    <p className="ai-fix-advice">
                      {fixState.name === "applied" && (
                        <Check size={13} className="ai-fix-done" />
                      )}
                      {dimension.fix.advice}
                    </p>

                    {/* 没有改写文本就只留建议：摆一个点了等于没点的采纳按钮更糟 */}
                    {fixState.name === "expanded" &&
                      dimension.fix.replacement && (
                        <div className="ai-fix-body">
                          <p className="ai-fix-next">
                            <CornerDownRight size={12} />
                            {dimension.fix.replacement}
                          </p>
                          {!fixState.located && (
                            <p className="ai-fix-warn">
                              {
                                "未能在正文中定位到这段原文，可能是模型摘引时改了措辞，请对照建议手动修改"
                              }
                            </p>
                          )}
                          <div className="ai-fix-actions">
                            <button
                              type="button"
                              className="ai-panel-btn"
                              onClick={() =>
                                setFixState(dimension.id, { name: "dismissed" })
                              }
                            >
                              不采纳
                            </button>
                            <button
                              type="button"
                              className="ai-panel-btn is-primary"
                              disabled={!canApply || !fixState.located}
                              onClick={() => handleAccept(dimension)}
                            >
                              采纳
                            </button>
                          </div>
                        </div>
                      )}

                    {fixState.name === "applied" && (
                      <div className="ai-fix-body">
                        <p className="ai-fix-applied">
                          已替换为「{dimension.fix.replacement}」
                        </p>
                        {fixState.revertFailed && (
                          <p className="ai-fix-warn">
                            {"这段已被改动过，撤销不了，请手动调整"}
                          </p>
                        )}
                        <div className="ai-fix-actions">
                          <button
                            type="button"
                            className="ai-panel-btn"
                            onClick={() => handleRevert(dimension, fixState)}
                          >
                            <Undo2 size={12} />
                            撤销
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {unparsed && (
        <div className="ai-panel-fallback">
          <p className="ai-panel-note">
            模型没有按预期格式返回，下面是它的原始输出。可以重新审阅再试一次。
          </p>
          {raw.trim() ? (
            <pre className="ai-panel-raw">{raw.trim()}</pre>
          ) : (
            <p className="ai-panel-note">这次没有收到任何内容。</p>
          )}
        </div>
      )}

      <div
        className={`ai-panel-footer${hasContent || unparsed ? "" : " is-bare"}`}
      >
        {running ? (
          <>
            <PixelLoader label={thinking ? "模型正在思考" : "正在通读全文"} />
            <button
              type="button"
              className="ai-panel-btn"
              onClick={() => {
                cancel();
                onClose();
              }}
            >
              停止
            </button>
          </>
        ) : (
          <>
            <button type="button" className="ai-panel-btn" onClick={onRerun}>
              重新审阅
            </button>
            {variant === "popover" && (
              <button
                type="button"
                className="ai-panel-btn is-primary"
                onClick={onClose}
              >
                关闭
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
