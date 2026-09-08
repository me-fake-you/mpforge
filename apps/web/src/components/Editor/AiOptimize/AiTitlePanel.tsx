import { useEffect, useState } from "react";
import { Settings2 } from "lucide-react";

import {
  getAiConfig,
  requestOpenAiSettings,
} from "../../../services/ai/aiConfig";
import {
  buildTitleMessages,
  parseTitleCandidates,
} from "../../../services/ai/aiPrompts";
import {
  MAX_TITLE_CHARS,
  isPlaceholderTitle,
  prepareDocument,
} from "../../../services/ai/aiSelection";
import { PixelLoader, ThinkingTrace } from "../../common";
import { useOptimizeRun } from "./useOptimizeRun";

interface AiTitlePanelProps {
  markdown: string;
  /** 文章列表里的标题，也是替换目标 */
  currentTitle: string;
  onClose: () => void;
  onReplaceTitle: (title: string) => void;
  /** 换 key 重挂载整块面板；本地状态随之清空，不用逐个手动重置 */
  onRerun: () => void;
}

export function AiTitlePanel({
  markdown,
  currentTitle,
  onClose,
  onReplaceTitle,
  onRerun,
}: AiTitlePanelProps) {
  const untitled = isPlaceholderTitle(currentTitle);
  const payload = prepareDocument(markdown);
  const [chosen, setChosen] = useState<string | null>(null);
  const { state, reasoning, thinkingMs, start, cancel } =
    useOptimizeRun(parseTitleCandidates);

  useEffect(() => {
    void start(buildTitleMessages(payload.text, getAiConfig().preference));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state.name === "error") {
    return (
      <div className="ai-panel">
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
  const result =
    state.name === "idle"
      ? { candidates: [], picked: undefined, pickReason: undefined }
      : state.parsed;
  const { candidates, picked, pickReason } = result;
  const raw = state.name === "idle" ? "" : state.raw;
  const unparsed = state.name === "done" && candidates.length === 0;

  return (
    <div className="ai-panel">
      <ThinkingTrace
        text={reasoning}
        active={thinking}
        durationMs={thinkingMs}
      />

      {payload.truncated && (
        <p className="ai-panel-note">
          正文共 {payload.totalChars} 字，仅依据前 {payload.text.length}{" "}
          字拟标题
        </p>
      )}

      <div className="ai-title-current">
        <span className="ai-panel-label">文章标题</span>
        <span className="ai-title-current-text">
          {untitled ? "还没有标题" : currentTitle}
        </span>
      </div>

      {picked && pickReason && (
        <p className="ai-title-reason">推荐理由：{pickReason}</p>
      )}

      {candidates.length > 0 && (
        <ul className="ai-title-list">
          {candidates.map((candidate) => (
            <li key={candidate.direction}>
              <button
                type="button"
                className={`ai-title-option${
                  candidate.direction === picked ? " is-featured" : ""
                }${chosen === candidate.title ? " is-picked" : ""}`}
                aria-pressed={chosen === candidate.title}
                disabled={candidate.overLimit || candidate.unavailable}
                onClick={() => setChosen(candidate.title)}
              >
                <span className="ai-title-direction">
                  {candidate.directionLabel}
                </span>
                <span className="ai-title-text">
                  {candidate.unavailable ? "本文无可验证数字" : candidate.title}
                </span>
                {candidate.direction === picked && (
                  <span className="ai-title-featured">推荐</span>
                )}
                {!candidate.unavailable && (
                  <span
                    className={`ai-title-count${candidate.overLimit ? " is-over" : ""}`}
                  >
                    {candidate.length}/{MAX_TITLE_CHARS}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {unparsed && (
        <div className="ai-panel-fallback">
          <p className="ai-panel-note">
            模型没有按预期格式返回，下面是它的原始输出。可以重新生成再试一次。
          </p>
          {raw.trim() ? (
            <pre className="ai-panel-raw">{raw.trim()}</pre>
          ) : (
            <p className="ai-panel-note">这次没有收到任何内容。</p>
          )}
        </div>
      )}

      <div
        className={`ai-panel-footer${
          candidates.length > 0 || unparsed ? "" : " is-bare"
        }`}
      >
        {running ? (
          <>
            <PixelLoader label={thinking ? "模型正在思考" : "正在拟标题"} />
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
              重新生成
            </button>
            <button type="button" className="ai-panel-btn" onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              className="ai-panel-btn is-primary"
              disabled={!chosen}
              onClick={() => chosen && onReplaceTitle(chosen)}
            >
              {untitled ? "用作标题" : "替换标题"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
