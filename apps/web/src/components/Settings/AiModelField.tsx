import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, RefreshCw } from "lucide-react";

import { AiRequestError, fetchModels } from "../../services/ai/aiClient";
import type { AiConfig } from "../../services/ai/aiConfig";
import { PixelLoader } from "../common";
import { computeDropdownBox, type DropdownBox } from "./dropdownBox";

type ListState =
  | { name: "idle" }
  | { name: "loading" }
  | { name: "ready"; models: string[] }
  | { name: "error"; message: string };

interface AiModelFieldProps {
  config: AiConfig;
  onChange: (model: string) => void;
  placeholder: string;
}

export function AiModelField({
  config,
  onChange,
  placeholder,
}: AiModelFieldProps) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<ListState>({ name: "idle" });
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<DropdownBox | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 换服务商或换 Key 后，上一次拉到的列表就不适用了
  useEffect(() => {
    setList({ name: "idle" });
    setOpen(false);
  }, [config.provider, config.baseUrl, config.apiKey]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // 弹窗 body 是 overflow:auto，绝对定位的下拉会被裁掉，只能挂到 body 上定位
  useLayoutEffect(() => {
    if (!open) {
      setBox(null);
      return;
    }

    const measure = () => {
      const anchor = inputRef.current?.getBoundingClientRect();
      if (!anchor) return;
      setBox(
        computeDropdownBox(anchor, {
          width: window.innerWidth,
          height: window.innerHeight,
        }),
      );
    };

    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    // 弹窗内容变高、表单重排都会让锚点位移，只听 resize/scroll 会留下过期坐标
    const observer = new ResizeObserver(measure);
    if (inputRef.current) observer.observe(inputRef.current);
    observer.observe(document.body);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      const insideRoot = rootRef.current?.contains(event.target as Node);
      const insideList = listRef.current?.contains(event.target as Node);
      if (!insideRoot && !insideList) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const load = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setList({ name: "loading" });

    try {
      const models = await fetchModels({ config, signal: controller.signal });
      if (controller.signal.aborted) return;
      setList({ name: "ready", models });
    } catch (error) {
      if (error instanceof AiRequestError && error.kind === "aborted") return;
      setList({
        name: "error",
        message:
          error instanceof AiRequestError
            ? error.message
            : "拉取模型列表失败，可直接手动填写模型名",
      });
    }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) setQuery("");
    if (next && list.name === "idle") void load();
  };

  // 过滤只看下拉内的搜索框。用输入框里已选中的值过滤会把同系列其他模型全挡掉
  const keyword = query.trim().toLowerCase();
  const visible =
    list.name === "ready"
      ? list.models.filter((model) => model.toLowerCase().includes(keyword))
      : [];

  return (
    <div className="ai-model-field" ref={rootRef}>
      <div className="ai-model-input" ref={inputRef}>
        <input
          id="ai-model"
          type="text"
          placeholder={placeholder}
          value={config.model}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          className="ai-model-toggle"
          aria-label="选择模型"
          aria-expanded={open}
          onClick={toggle}
        >
          <ChevronDown size={14} className={open ? "is-open" : undefined} />
        </button>
      </div>

      {open &&
        box &&
        createPortal(
          <div ref={listRef} className="ai-model-list" style={box}>
            {list.name === "ready" && list.models.length > 0 && (
              <input
                className="ai-model-search"
                type="text"
                autoFocus
                placeholder={`搜索 ${list.models.length} 个模型`}
                aria-label="搜索模型"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            )}

            <div className="ai-model-options" role="listbox">
              {list.name === "loading" && (
                <div className="ai-model-status">
                  <PixelLoader label="正在获取模型列表" />
                </div>
              )}

              {list.name === "error" && (
                <div className="ai-model-status is-error">
                  <p>{list.message}</p>
                  <button
                    type="button"
                    className="ai-model-retry"
                    onClick={load}
                  >
                    <RefreshCw size={12} />
                    重试
                  </button>
                </div>
              )}

              {list.name === "ready" && visible.length === 0 && (
                <div className="ai-model-status">
                  没有匹配的模型，可直接手动填写模型名
                </div>
              )}

              {visible.map((model) => (
                <button
                  key={model}
                  type="button"
                  role="option"
                  aria-selected={model === config.model}
                  className="ai-model-option"
                  onClick={() => {
                    onChange(model);
                    setOpen(false);
                  }}
                >
                  <span>{model}</span>
                  {model === config.model && <Check size={13} />}
                </button>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
