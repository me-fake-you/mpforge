import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ContextMenu } from "../../components/Sidebar/ContextMenu";

describe("ContextMenu", () => {
  it("移动目标使用统一文件夹图标而不是 emoji", () => {
    render(
      <ContextMenu
        position={{ x: 0, y: 0 }}
        menuTarget={{
          name: "article.md",
          path: "article.md",
          createdAt: new Date(),
          updatedAt: new Date(),
          size: 0,
        }}
        menuTargetFolder={null}
        showMoveMenu
        allFolders={[{ name: "素材", path: "素材" }]}
        folderMoveTargets={[]}
        onClose={vi.fn()}
        onCopyTitle={vi.fn()}
        onStartRename={vi.fn()}
        onToggleMoveMenu={vi.fn()}
        onMoveToFolder={vi.fn()}
        onMoveFolder={vi.fn()}
        onDeleteFile={vi.fn()}
        onDeleteFolder={vi.fn()}
        onStartRenameFolder={vi.fn()}
        onNewFolder={vi.fn()}
      />,
    );

    const rootOption = screen.getByRole("button", { name: "根目录" });
    const folderOption = screen.getByRole("button", { name: "素材" });

    expect(rootOption.querySelector("svg")).not.toBeNull();
    expect(folderOption.querySelector("svg")).not.toBeNull();
    expect(document.body.textContent).not.toContain("📁");
  });
});
