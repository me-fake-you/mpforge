import { ChevronDown, ChevronUp, Download } from "lucide-react";
import { useState } from "react";
import { Modal } from "../common";
import "./UpdateModal.css";

interface UpdateModalProps {
  latestVersion: string;
  currentVersion: string;
  releaseNotes?: string;
  onClose: () => void;
  onDownload: () => void;
  onSkipVersion: () => void;
}

// GitHub release notes 为 Markdown，此处仅做轻量符号化，不引入解析器
const formatReleaseNotes = (notes: string) =>
  notes
    .replace(/^### /gm, "◆ ")
    .replace(/^## /gm, "▸ ")
    .replace(/^# /gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/`(.*?)`/g, "$1")
    .replace(/^- /gm, "• ")
    .trim();

export function UpdateModal({
  latestVersion,
  currentVersion,
  releaseNotes,
  onClose,
  onDownload,
  onSkipVersion,
}: UpdateModalProps) {
  const [showNotes, setShowNotes] = useState(false);

  return (
    <Modal
      open
      onClose={onClose}
      title="发现新版本"
      description={`当前 ${currentVersion}，最新 ${latestVersion}`}
      className="update-modal"
      bodyClassName="update-modal-body"
    >
      {releaseNotes && (
        <div className="update-modal-notes-section">
          <button
            className="update-modal-notes-toggle"
            onClick={() => setShowNotes(!showNotes)}
            aria-expanded={showNotes}
          >
            {showNotes ? (
              <ChevronUp size={14} aria-hidden="true" />
            ) : (
              <ChevronDown size={14} aria-hidden="true" />
            )}
            {showNotes ? "收起更新日志" : "查看更新日志"}
          </button>

          {showNotes && (
            <div className="update-modal-notes">
              <pre>{formatReleaseNotes(releaseNotes)}</pre>
            </div>
          )}
        </div>
      )}

      <div className="update-modal-actions">
        <button className="update-modal-skip" onClick={onSkipVersion}>
          跳过此版本
        </button>
        <div className="update-modal-actions-main">
          <button className="update-modal-btn" onClick={onClose}>
            稍后提醒
          </button>
          <button className="update-modal-btn primary" onClick={onDownload}>
            <Download size={14} aria-hidden="true" />
            前往下载
          </button>
        </div>
      </div>
    </Modal>
  );
}
