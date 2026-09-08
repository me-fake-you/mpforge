import {
  BookOpenCheck,
  FilePenLine,
  FolderKanban,
  Image,
  Send,
  Settings,
} from "lucide-react";
import { useAppViewStore, type AppView } from "../../store/appViewStore";
import "./WorkspaceNavigation.css";

const destinations: Array<{
  id: AppView;
  label: string;
  icon: typeof FolderKanban;
}> = [
  { id: "dashboard", label: "Dashboard", icon: FolderKanban },
  { id: "editor", label: "Editor", icon: FilePenLine },
  { id: "review", label: "Review", icon: BookOpenCheck },
  { id: "assets", label: "Assets", icon: Image },
  { id: "publish", label: "Publish", icon: Send },
  { id: "settings", label: "Settings", icon: Settings },
];

export function WorkspaceNavigation() {
  const activeView = useAppViewStore((state) => state.activeView);
  const setActiveView = useAppViewStore((state) => state.setActiveView);

  return (
    <nav className="workspace-navigation" aria-label="MPForge workspace">
      <span className="workspace-navigation__brand">
        <span className="workspace-navigation__brand-mark" aria-hidden="true">
          MP
        </span>
        <span>
          <strong>MPForge</strong>
          <small>Content-as-Code</small>
        </span>
      </span>
      <span className="workspace-navigation__destinations">
        {destinations.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className="workspace-navigation__button"
            data-active={activeView === id}
            aria-current={activeView === id ? "page" : undefined}
            onClick={() => setActiveView(id)}
          >
            <Icon size={15} strokeWidth={1.8} />
            <span>{label}</span>
          </button>
        ))}
      </span>
    </nav>
  );
}
