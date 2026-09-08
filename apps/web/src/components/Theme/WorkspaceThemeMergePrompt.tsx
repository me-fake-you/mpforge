import { Modal } from "../common/Modal";
import { useThemeStore } from "../../store/themeStore";
import "./WorkspaceThemeMergePrompt.css";

/**
 * 本机存在、当前工作区没有的自定义主题，首次打开该工作区时询问一次
 */
export function WorkspaceThemeMergePrompt() {
  const pendingThemes = useThemeStore((state) => state.pendingLocalOnlyThemes);
  const acceptPendingThemes = useThemeStore(
    (state) => state.acceptPendingThemes,
  );
  const dismissPendingThemes = useThemeStore(
    (state) => state.dismissPendingThemes,
  );
  // Esc 或点遮罩只是本次不处理，不记住选择，避免误操作后主题永久不可见
  const snoozePendingThemes = useThemeStore(
    (state) => state.snoozePendingThemes,
  );

  return (
    <Modal
      open={pendingThemes.length > 0}
      onClose={snoozePendingThemes}
      title="本机还有其他自定义主题"
      description="自定义主题保存在当前本地文件夹中，以下主题只存在于本机"
      className="modal-narrow"
    >
      <ul className="theme-merge-list">
        {pendingThemes.map((theme) => (
          <li key={theme.id}>{theme.name}</li>
        ))}
      </ul>
      <div className="theme-merge-actions">
        <button className="btn-secondary" onClick={dismissPendingThemes}>
          不加入
        </button>
        <button className="btn-primary" onClick={acceptPendingThemes}>
          加入此文件夹
        </button>
      </div>
    </Modal>
  );
}
