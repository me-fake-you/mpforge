import { Check, Database, FolderOpen, Info, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import type { StorageType } from "../../storage/types";
import { useStorageContext } from "../../storage/StorageContext";
import "./StorageModeSelector.css";

const OPTIONS: {
  type: StorageType;
  label: string;
  description: string;
  notice: string;
}[] = [
  {
    type: "filesystem",
    label: "本地文件夹",
    description: "直接读写指定文件夹中的 Markdown 文件。",
    notice: "清理站点权限或更换浏览器后，需要重新授权文件夹。",
  },
  {
    type: "indexeddb",
    label: "浏览器存储",
    description: "文章保存在当前浏览器中，关闭网页后仍会保留。",
    notice: "清除 Cookie 及网站数据会删除本地文章，请定期导出备份。",
  },
];

export function StorageModeSelector() {
  const { type, message, select, isFileSystemSupported, ready } =
    useStorageContext();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (ready) setLoading(false);
  }, [ready]);

  const handleSelect = async (nextType: StorageType) => {
    setLoading(true);
    await select(nextType);
    setLoading(false);
  };

  return (
    <div className="storage-mode-selector">
      <div className="storage-mode-options">
        {OPTIONS.map((option) => {
          const disabled =
            option.type === "filesystem" && !isFileSystemSupported;
          const active = type === option.type;
          const OptionIcon =
            option.type === "filesystem" ? FolderOpen : Database;
          return (
            <button
              key={option.type}
              className={`storage-mode-option ${active ? "active" : ""}`}
              disabled={disabled || loading}
              onClick={() => handleSelect(option.type)}
              aria-pressed={active}
            >
              <span className="storage-mode-option__icon" aria-hidden="true">
                <OptionIcon size={17} strokeWidth={1.8} />
              </span>
              <div className="storage-mode-option__content">
                <div className="storage-mode-option__label">
                  <span>{option.label}</span>
                  {active && <small>当前</small>}
                </div>
                <p>
                  {disabled
                    ? "当前浏览器不支持本地文件夹访问"
                    : option.description}
                </p>
                <p className="storage-mode-notice">
                  <Info size={13} strokeWidth={2} aria-hidden="true" />
                  <span>{option.notice}</span>
                </p>
              </div>
              <span className="storage-mode-option__state" aria-hidden="true">
                {loading && active ? (
                  <LoaderCircle className="storage-mode-spinner" size={16} />
                ) : active ? (
                  <Check size={16} strokeWidth={2.2} />
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
      {message && <div className="storage-mode-status">{message}</div>}
    </div>
  );
}
