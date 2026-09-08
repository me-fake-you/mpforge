import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { Round3DraftWorkspace } from "../../components/AppShell/Round3DraftWorkspace";
import type { WorkbenchEvidence } from "../../services/mpforgeWorkbench";
import type { FileItem } from "../../store/fileTypes";

const article: FileItem = {
  name: "article.md",
  path: "content/release-ready-article/article.md",
  title: "Release ready",
  createdAt: new Date("2026-09-01T00:00:00.000Z"),
  updatedAt: new Date("2026-09-01T00:00:00.000Z"),
  size: 100,
};

const evidence = {
  available: true,
  status: "approved",
  assets: [],
  lint: { summary: { errors: 0, warnings: 0, info: 0 } },
  preview: { chromiumComplete: true, stale: false },
} as unknown as WorkbenchEvidence;

describe("Round 3 Draft Workspace", () => {
  beforeEach(() => {
    Object.defineProperty(window, "electron", {
      configurable: true,
      value: undefined,
    });
  });

  it("renders six user-visible pipeline workspaces", () => {
    render(<Round3DraftWorkspace currentFile={article} evidence={evidence} />);
    const navigation = screen.getByRole("navigation", {
      name: "Draft pipeline workspaces",
    });
    expect(navigation).toBeInTheDocument();
    for (const name of [
      "Accounts",
      "Draft Preparation",
      "Mock Draft",
      "Real Draft Confirmation",
      "Operations",
      "Receipt",
    ]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("shows the exact real request title/button without a challenge input", () => {
    render(<Round3DraftWorkspace currentFile={article} evidence={evidence} />);
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

  it("marks the Mock workspace conspicuously", () => {
    render(<Round3DraftWorkspace currentFile={article} evidence={evidence} />);
    fireEvent.click(screen.getByRole("button", { name: "Mock Draft" }));
    expect(screen.getByText("MOCK · LOCAL ONLY")).toBeInTheDocument();
    expect(
      screen.getByText(/never evidence of a live account draft/i),
    ).toBeInTheDocument();
  });
});
