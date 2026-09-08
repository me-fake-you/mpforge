import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { serializeArticleDocument } from "@mpforge/content-schema";
import { transitionArticle as transitionStoredArticle } from "@mpforge/content-store";
import {
  CliError,
  approveArticle,
  createArticle,
  draftArticle,
  initializeWorkspace,
  makeLintReport,
  readArticle,
  renderArticle,
  resolveArticlePath,
  transitionArticle,
} from "./cli.js";
import { runCommand } from "./index.js";
import { resolvePreviewBrowser } from "./preview.js";

async function tempRoot() {
  const parent = path.join(process.cwd(), "tmp");
  await mkdir(parent, { recursive: true });
  return mkdtemp(path.join(parent, "mpforge-cli-"));
}

async function approvedFixture(root: string, slug: string) {
  const created = await createArticle(slug, root);
  const now = new Date().toISOString();
  await writeFile(
    path.join(created.articleDirectory, "assets", "cover.png"),
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X3XxAAAAAElFTkSuQmCC",
      "base64",
    ),
  );
  await writeFile(
    created.articlePath,
    serializeArticleDocument({
      ...created.document,
      frontmatter: {
        ...created.frontmatter,
        title: "A production-ready article",
        summary: "A deterministic command-line integration fixture.",
        author: "MPForge QA",
        account: "qa-account",
        cover: "assets/cover.png",
        updated_at: now,
      },
      body: "# Production-ready article\n\nThis article verifies the complete local draft pipeline.\n",
    }),
    "utf8",
  );
  for (const target of ["draft", "reviewing", "reviewed"] as const) {
    await transitionArticle(
      slug,
      target,
      { actorId: "qa-automation", reason: "CLI integration fixture" },
      root,
    );
  }
  // Dedicated test harness: production approval has no programmatic bypass.
  await transitionStoredArticle(root, slug, "approved", {
    actorType: "human",
    actorId: "qa-reviewer",
    reason: "Test-only human approval fixture",
    sourceCommit: "test-harness",
    explicitHumanAction: true,
  });
  await writeFile(
    path.join(created.articleDirectory, "history", "approvals.jsonl"),
    '{"test_harness":true}\n',
    "utf8",
  );
  return readArticle(slug, root);
}

describe("MPForge CLI contracts", () => {
  it("resolves slugs and rejects workspace escapes", () => {
    const root = "C:\\workspace\\mpforge";
    expect(resolveArticlePath(root, "hello").articlePath).toContain(
      path.join("content", "hello", "article.md"),
    );
    expect(() => resolveArticlePath(root, "../secret")).toThrow();
    expect(() =>
      resolveArticlePath(root, "content/a/../../secret/article.md"),
    ).toThrow();
  });

  it("creates a Content-as-Code article with required folders", async () => {
    const root = await tempRoot();
    try {
      const article = await createArticle("cli-smoke", root);
      expect(article.articlePath).toContain(path.join("content", "cli-smoke"));
      expect(article.document.frontmatter.status).toBe("idea");
      expect(
        await readFile(
          path.join(
            root,
            "content",
            "cli-smoke",
            "history",
            "state-events.jsonl",
          ),
          "utf8",
        ),
      ).toBe("");
      expect(article.frontmatter.slug).toBe("cli-smoke");
      expect(article.frontmatter.version).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("blocks a missing local image deterministically", async () => {
    const root = await tempRoot();
    try {
      const article = await createArticle("lint-smoke", root);
      const source = await readFile(article.articlePath, "utf8");
      await writeFile(
        article.articlePath,
        source + "\n![diagram](assets/missing.png)\n",
        "utf8",
      );
      const updated = await readArticle("lint-smoke", root);
      const report = makeLintReport(updated);
      expect(report.passed).toBe(false);
      expect(
        report.issues.some((issue) => issue.code === "image.local.missing"),
      ).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses typed errors for missing articles", async () => {
    await expect(
      readArticle("not-there", await tempRoot()),
    ).rejects.toMatchObject({
      code: "ARTICLE_NOT_FOUND",
    } satisfies Partial<CliError>);
  });

  it("initializes a self-identifying workspace without overwriting its marker", async () => {
    const root = await tempRoot();
    try {
      await initializeWorkspace(root);
      const first = await readFile(
        path.join(root, ".project-root.json"),
        "utf8",
      );
      await initializeWorkspace(root);
      expect(
        await readFile(path.join(root, ".project-root.json"), "utf8"),
      ).toBe(first);
      expect(JSON.parse(first)).toMatchObject({
        project_name: "MPForge",
        absolute_path: path.resolve(root),
      });
      expect((await stat(path.join(root, "content"))).isDirectory()).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("passes the selected theme and light/dark scheme to the real renderer", async () => {
    const root = await tempRoot();
    try {
      const article = await approvedFixture(root, "render-integration");
      const light = await renderArticle(article, "light");
      const dark = await renderArticle(article, "dark");
      expect(light.themeId).toBe("minimal");
      expect(light.documentHtml).toContain('data-color-scheme="light"');
      expect(dark.documentHtml).toContain('data-color-scheme="dark"');
      expect(dark.hashes.document).not.toBe(light.hashes.document);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.skipIf(!resolvePreviewBrowser())(
    "captures real project-local Chromium previews as PNG files",
    async () => {
      const root = await tempRoot();
      try {
        await approvedFixture(root, "preview-integration");
        const result = (await runCommand(
          ["preview", "preview-integration"],
          root,
          () => undefined,
        )) as { screenshot: string[] };
        const build = path.join(
          root,
          "content",
          "preview-integration",
          "build",
        );
        const light = path.join(build, "preview-source-light.png");
        const dark = path.join(build, "preview-source-dark.png");
        expect(result.screenshot).toContain("preview-source-light.png");
        expect(existsSync(light)).toBe(true);
        expect(existsSync(dark)).toBe(true);
        expect((await readFile(light)).subarray(0, 8)).toEqual(
          Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    15_000,
  );

  it("blocks the removed direct mock draft path", async () => {
    const root = await tempRoot();
    try {
      await approvedFixture(root, "mock-draft");
      await expect(
        draftArticle("mock-draft", { mock: true }, root),
      ).rejects.toMatchObject({ code: "TWO_PHASE_DRAFT_REQUIRED" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("blocks the removed direct real draft path before credential access", async () => {
    const root = await tempRoot();
    const names = [
      "MPFORGE_APP_ID",
      "MPFORGE_APP_SECRET",
      "MPFORGE_QA_ACCOUNT_APP_ID",
      "MPFORGE_QA_ACCOUNT_APP_SECRET",
    ] as const;
    const previous = Object.fromEntries(
      names.map((name) => [name, process.env[name]]),
    );
    names.forEach((name) => delete process.env[name]);
    try {
      await approvedFixture(root, "real-draft-safe-failure");
      await expect(
        draftArticle(
          "real-draft-safe-failure",
          { mock: false, accountAlias: "qa-account", confirm: true },
          root,
        ),
      ).rejects.toMatchObject({ code: "TWO_PHASE_DRAFT_REQUIRED" });
    } finally {
      for (const name of names) {
        const value = previous[name];
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not infer a human approval from an automated CLI call", async () => {
    const root = await tempRoot();
    try {
      await createArticle("approval-gate", root);
      await expect(
        approveArticle(
          "approval-gate",
          { confirmedHumanReview: false, actorId: "" },
          root,
        ),
      ).rejects.toMatchObject({
        code: "APPROVAL_BYPASS_BLOCKED",
      });
      expect(
        (await readArticle("approval-gate", root)).frontmatter.status,
      ).toBe("idea");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
