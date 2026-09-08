import {
  parseArticleDocument,
  serializeArticleDocument,
  serializeFrontmatter,
  validateFrontmatter,
  type FrontmatterValue,
} from "@mpforge/content-schema";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFileStore } from "../../store/fileStore";
import "./ArticleFrontmatterPanel.css";

type FrontmatterRecord = Record<string, FrontmatterValue | undefined>;

interface ArticleFrontmatterPanelProps {
  source: string;
  onSaveSource: (source: string) => Promise<boolean>;
  onBuild: () => Promise<boolean>;
}

function parseSource(source: string) {
  try {
    const document = parseArticleDocument(source);
    const validation = validateFrontmatter(document.frontmatter);
    return { document, errors: validation.errors };
  } catch (error) {
    return {
      document: null,
      errors: [error instanceof Error ? error.message : "Frontmatter 解析失败"],
    };
  }
}

function nullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function ArticleFrontmatterPanel({
  source,
  onSaveSource,
  onBuild,
}: ArticleFrontmatterPanelProps) {
  const parsed = useMemo(() => parseSource(source), [source]);
  const frontmatter = parsed.document?.frontmatter ?? {};
  const canonicalRaw = parsed.document
    ? serializeFrontmatter(frontmatter, parsed.document.lineEnding)
    : "";
  const [raw, setRaw] = useState(canonicalRaw);
  const [rawDirty, setRawDirty] = useState(false);
  const [rawErrors, setRawErrors] = useState<string[]>(parsed.errors);
  const [buildState, setBuildState] = useState<
    "idle" | "building" | "success" | "failed"
  >("idle");
  const saveGeneration = useRef(0);
  const isSaving = useFileStore((state) => state.isSaving);
  const lastSavedAt = useFileStore((state) => state.lastSavedAt);
  const isDirty = useFileStore((state) => state.isDirty);

  useEffect(() => {
    if (rawDirty) return;
    setRaw(canonicalRaw);
    setRawErrors(parsed.errors);
  }, [canonicalRaw, parsed.errors, rawDirty]);

  const saveFrontmatter = async (next: FrontmatterRecord) => {
    if (!parsed.document) return false;
    const nextFrontmatter = {
      ...frontmatter,
      ...next,
      updated_at: new Date().toISOString(),
    };
    const validation = validateFrontmatter(nextFrontmatter);
    setRawErrors(validation.errors);
    if (!validation.valid) return false;
    return onSaveSource(
      serializeArticleDocument({
        ...parsed.document,
        frontmatter: nextFrontmatter,
      }),
    );
  };

  useEffect(() => {
    if (!rawDirty || !parsed.document) return;
    const generation = ++saveGeneration.current;
    const timer = window.setTimeout(() => {
      try {
        const candidate = parseArticleDocument(
          `---${parsed.document!.lineEnding}${raw}${parsed.document!.lineEnding}---${parsed.document!.lineEnding}${parsed.document!.lineEnding}${parsed.document!.body}`,
        );
        const nextFrontmatter = {
          ...candidate.frontmatter,
          updated_at: new Date().toISOString(),
        };
        const validation = validateFrontmatter(nextFrontmatter);
        setRawErrors(validation.errors);
        if (!validation.valid) return;
        void onSaveSource(
          serializeArticleDocument({
            ...candidate,
            frontmatter: nextFrontmatter,
          }),
        ).then((saved) => {
          if (saved && saveGeneration.current === generation)
            setRawDirty(false);
        });
      } catch (error) {
        setRawErrors([
          error instanceof Error ? error.message : "Frontmatter 解析失败",
        ]);
      }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [onSaveSource, parsed.document, raw, rawDirty]);

  const text = (key: string) =>
    typeof frontmatter[key] === "string" ? String(frontmatter[key]) : "";
  const checked = (key: string) => frontmatter[key] === true;
  const tasks = Array.isArray(frontmatter.ai_tasks)
    ? frontmatter.ai_tasks.filter(
        (item): item is string => typeof item === "string",
      )
    : [];

  const build = async () => {
    setBuildState("building");
    const ok = await onBuild();
    setBuildState(ok ? "success" : "failed");
  };

  return (
    <details className="article-frontmatter" open>
      <summary>
        <span>Frontmatter</span>
        <span className="article-frontmatter__save" data-dirty={isDirty}>
          {isSaving
            ? "保存中…"
            : isDirty
              ? "等待自动保存"
              : lastSavedAt
                ? `已保存 ${lastSavedAt.toLocaleTimeString()}`
                : "已载入"}
        </span>
      </summary>

      {!parsed.document ? (
        <p className="article-frontmatter__error">{parsed.errors.join("；")}</p>
      ) : (
        <div className="article-frontmatter__body">
          <div className="article-frontmatter__identity">
            <label>
              <span>ID</span>
              <input value={text("id")} readOnly />
            </label>
            <label>
              <span>Slug</span>
              <input value={text("slug")} readOnly />
            </label>
            <label>
              <span>状态</span>
              <input value={text("status")} readOnly />
            </label>
          </div>

          <div className="article-frontmatter__grid">
            {[
              ["title", "标题"],
              ["summary", "摘要"],
              ["author", "作者"],
              ["account", "账号别名"],
            ].map(([key, label]) => (
              <label key={key}>
                <span>{label}</span>
                <input
                  value={text(key)}
                  onChange={(event) =>
                    void saveFrontmatter({ [key]: event.target.value })
                  }
                />
              </label>
            ))}
            <label>
              <span>封面</span>
              <input
                value={text("cover")}
                onChange={(event) =>
                  void saveFrontmatter({
                    cover: nullableText(event.target.value),
                  })
                }
              />
            </label>
            <label>
              <span>来源 URL</span>
              <input
                value={text("source_url")}
                onChange={(event) =>
                  void saveFrontmatter({
                    source_url: nullableText(event.target.value),
                  })
                }
              />
            </label>
            <label className="article-frontmatter__wide">
              <span>AI tasks（逗号分隔）</span>
              <input
                value={tasks.join(", ")}
                onChange={(event) =>
                  void saveFrontmatter({
                    ai_tasks: event.target.value
                      .split(",")
                      .map((item) => item.trim())
                      .filter(Boolean),
                  })
                }
              />
            </label>
          </div>

          <div className="article-frontmatter__checks">
            {[
              ["original", "原创"],
              ["ai_assisted", "AI 辅助"],
              ["need_open_comment", "开放评论"],
              ["only_fans_can_comment", "仅粉丝评论"],
            ].map(([key, label]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={checked(key)}
                  onChange={(event) =>
                    void saveFrontmatter({ [key]: event.target.checked })
                  }
                />
                <span>{label}</span>
              </label>
            ))}
          </div>

          <label className="article-frontmatter__raw">
            <span>直接编辑 YAML Frontmatter</span>
            <textarea
              aria-label="直接编辑 YAML Frontmatter"
              value={raw}
              spellCheck={false}
              onChange={(event) => {
                setRaw(event.target.value);
                setRawDirty(true);
              }}
            />
          </label>
          {rawErrors.length > 0 && (
            <div className="article-frontmatter__error" role="alert">
              {rawErrors.map((error) => (
                <span key={error}>{error}</span>
              ))}
            </div>
          )}
          <div className="article-frontmatter__actions">
            <span>Schema 校验通过后才会写入；未知字段原样保留。</span>
            <button
              type="button"
              onClick={() => void build()}
              disabled={buildState === "building" || rawErrors.length > 0}
            >
              {buildState === "building"
                ? "构建中…"
                : buildState === "success"
                  ? "构建完成"
                  : "构建 HTML"}
            </button>
          </div>
        </div>
      )}
    </details>
  );
}
