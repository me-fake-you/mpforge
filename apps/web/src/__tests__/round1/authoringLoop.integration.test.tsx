import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildArticleDocument,
  parseArticleDocument,
  serializeArticleDocument,
} from "@mpforge/content-schema";
import { ArticleFrontmatterPanel } from "../../components/Editor/ArticleFrontmatterPanel";
import { buildWorkbenchEvidence } from "../../services/mpforgeWorkbench";
import { useFileStore } from "../../store/fileStore";

function fixtureSource(): string {
  const parsed = parseArticleDocument(
    buildArticleDocument(
      {
        id: "round1-web-integration",
        slug: "round1-web-integration",
        title: "初始标题",
        summary: "Round 1 Web 集成样例",
        author: "MPForge QA",
        account: "local-test",
        theme: "minimal",
        status: "draft",
        cover: null,
        source_url: null,
        original: true,
        ai_assisted: true,
        ai_tasks: ["proofreading"],
        human_reviewed: false,
        need_open_comment: true,
        only_fans_can_comment: false,
        created_at: "2026-08-31T00:00:00.000Z",
        updated_at: "2026-08-31T00:00:00.000Z",
        version: 1,
      },
      "# 保留的正文\n\n正文不能被 Frontmatter 表单覆盖。\n",
    ),
  );
  return serializeArticleDocument({
    ...parsed,
    frontmatter: {
      ...parsed.frontmatter,
      future_flag: true,
      future_list: ["alpha", "beta"],
    },
  });
}

describe("Round 1 Web authoring integration", () => {
  beforeEach(() => {
    useFileStore.setState({
      isSaving: false,
      isDirty: false,
      lastSavedAt: null,
    });
  });

  it("round-trips a form edit without deleting body or unknown frontmatter", async () => {
    const onSaveSource = vi.fn<(next: string) => Promise<boolean>>(
      async () => true,
    );

    render(
      <ArticleFrontmatterPanel
        source={fixtureSource()}
        onSaveSource={onSaveSource}
        onBuild={vi.fn(async () => true)}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "标题" }), {
      target: { value: "表单双向同步后的标题" },
    });

    await waitFor(() => expect(onSaveSource).toHaveBeenCalledTimes(1));
    const saved = parseArticleDocument(onSaveSource.mock.calls[0]![0]);
    expect(saved.frontmatter.title).toBe("表单双向同步后的标题");
    expect(saved.frontmatter.future_flag).toBe(true);
    expect(saved.frontmatter.future_list).toEqual(["alpha", "beta"]);
    expect(saved.body).toContain("正文不能被 Frontmatter 表单覆盖");
    expect(Date.parse(String(saved.frontmatter.updated_at))).not.toBeNaN();
  });

  it("keeps the last valid article intact when raw YAML is invalid", async () => {
    const onSaveSource = vi.fn(async () => true);

    render(
      <ArticleFrontmatterPanel
        source={fixtureSource()}
        onSaveSource={onSaveSource}
        onBuild={vi.fn(async () => true)}
      />,
    );

    fireEvent.change(
      screen.getByRole("textbox", {
        name: "直接编辑 YAML Frontmatter",
      }),
      { target: { value: "title: [unterminated" } },
    );

    expect(
      await screen.findByRole("alert", {}, { timeout: 2_000 }),
    ).toHaveTextContent(
      /Invalid YAML frontmatter|invalid inline array|unterminated/i,
    );
    expect(onSaveSource).not.toHaveBeenCalled();
  });

  it("exposes deterministic build evidence for both simulated color schemes", async () => {
    let currentSource = fixtureSource();
    const onSaveSource = vi.fn(async (next: string) => {
      currentSource = next;
      return true;
    });
    const onBuild = vi.fn(async () => true);

    render(
      <ArticleFrontmatterPanel
        source={currentSource}
        onSaveSource={onSaveSource}
        onBuild={onBuild}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "构建 HTML" }));
    expect(
      await screen.findByRole("button", { name: "构建完成" }),
    ).toBeVisible();
    expect(onBuild).toHaveBeenCalledTimes(1);

    const first = buildWorkbenchEvidence({
      articlePath: "content/round1-web-integration/article.md",
      source: currentSource,
    });
    const second = buildWorkbenchEvidence({
      articlePath: "content/round1-web-integration/article.md",
      source: currentSource,
    });
    expect(first.light?.documentHtml).toContain('data-color-scheme="light"');
    expect(first.dark?.documentHtml).toContain('data-color-scheme="dark"');
    expect(first.light?.hashes).toEqual(second.light?.hashes);
    expect(first.dark?.hashes).toEqual(second.dark?.hashes);
    expect(first.light?.html).toBe(second.light?.html);
  });
});
