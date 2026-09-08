import { beforeEach, describe, expect, it } from "vitest";
import { useFileStore } from "../../store/fileStore";

describe("fileStore 工作区修订号", () => {
  beforeEach(() => {
    useFileStore.setState({ workspacePath: null, workspaceRevision: 0 });
  });

  it("同名工作区重复提交时也会推进修订号", () => {
    const { setWorkspacePath, bumpWorkspaceRevision } = useFileStore.getState();

    setWorkspacePath("notes");
    bumpWorkspaceRevision();
    setWorkspacePath("notes");
    bumpWorkspaceRevision();

    expect(useFileStore.getState()).toMatchObject({
      workspacePath: "notes",
      workspaceRevision: 2,
    });
  });
});
