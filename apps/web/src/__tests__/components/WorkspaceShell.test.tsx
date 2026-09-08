import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceHub } from "../../components/AppShell/WorkspaceHub";
import { WorkspaceNavigation } from "../../components/AppShell/WorkspaceNavigation";
import { useAppViewStore } from "../../store/appViewStore";
import type { FileItem } from "../../store/fileTypes";

const article: FileItem = {
  name: "article.md",
  path: "content/hello-world/article.md",
  title: "Hello world",
  createdAt: new Date("2026-08-31T00:00:00.000Z"),
  updatedAt: new Date("2026-08-31T00:00:00.000Z"),
  size: 42,
};

describe("MPForge workspace shell", () => {
  beforeEach(() => {
    Object.defineProperty(window, "electron", {
      configurable: true,
      value: undefined,
    });
    useAppViewStore.setState({
      activeView: "editor",
      selectedArticlePath: null,
    });
  });

  it("navigates between all six product views", () => {
    render(<WorkspaceNavigation />);
    expect(screen.getAllByRole("button")).toHaveLength(6);
    fireEvent.click(screen.getByRole("button", { name: /Dashboard/i }));
    expect(useAppViewStore.getState().activeView).toBe("dashboard");
    expect(screen.getByRole("button", { name: /Dashboard/i })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("opens a Content-as-Code article from the dashboard", () => {
    const onOpenArticle = vi.fn();
    render(
      <WorkspaceHub
        view="dashboard"
        articles={[article]}
        currentFile={null}
        workspacePath="C:\\workspace"
        onCreateArticle={vi.fn()}
        onOpenArticle={onOpenArticle}
        onSelectWorkspace={vi.fn()}
      />,
    );
    expect(screen.getByText("Hello world")).toBeInTheDocument();
    expect(screen.getByText("hello-world")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Hello world/i }));
    expect(onOpenArticle).toHaveBeenCalledWith(article);
  });

  it("exposes all six Round 3 workspaces and keeps real execution outside Web", () => {
    render(
      <WorkspaceHub
        view="publish"
        articles={[article]}
        currentFile={article}
        workspacePath="C:\\workspace"
        onCreateArticle={vi.fn()}
        onOpenArticle={vi.fn()}
        onSelectWorkspace={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("navigation", { name: "Draft pipeline workspaces" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Accounts" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Draft Preparation" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Mock Draft" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Real Draft Confirmation" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Operations" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Receipt" })).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Real Draft Confirmation" }),
    );
    expect(
      screen.getByRole("heading", { name: "创建微信公众号草稿" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "确认创建公众号草稿" }),
    ).toBeDisabled();
    expect(screen.queryByLabelText(/challenge/i)).not.toBeInTheDocument();
  });
});
