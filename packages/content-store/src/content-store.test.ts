import {
  mkdir,
  readFile,
  readdir,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AutosaveController,
  ContentStoreError,
  createArticle,
  hashContent,
  listArticles,
  listRecoveryCandidates,
  listTrash,
  openArticle,
  restoreArticle,
  saveArticle,
  transitionArticle,
  trashArticle,
} from "./index.js";
import {
  parseArticleDocument,
  parseStateEvents,
  serializeArticleDocument,
} from "@mpforge/content-schema";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const testRootParent = path.join(packageRoot, "tmp", "content-store-tests");
let root: string;

beforeEach(async () => {
  await mkdir(testRootParent, { recursive: true });
  root = path.join(
    testRootParent,
    `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  await mkdir(root);
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(root, { recursive: true, force: true });
});

function editRaw(
  raw: string,
  patch: Record<string, unknown>,
  body?: string,
): string {
  const parsed = parseArticleDocument(raw);
  return serializeArticleDocument({
    ...parsed,
    body: body ?? parsed.body,
    frontmatter: { ...parsed.frontmatter, ...patch } as never,
  });
}

describe("content-as-code store", () => {
  it("creates the canonical layout, generates a safe slug, and blocks duplicates", async () => {
    const article = await createArticle(root, {
      title: "Hello MPForge!",
      body: "# Original\n",
      frontmatter: {
        author: "Editor",
        account: "personal",
        custom_boolean: true,
      },
      now: "2026-09-01T00:00:00.000Z",
    });
    expect(article.slug).toBe("hello-mpforge");
    expect(article.frontmatter).toMatchObject({
      slug: "hello-mpforge",
      version: 1,
      custom_boolean: true,
    });
    await expect(
      Promise.all([
        readFile(path.join(root, "content/hello-mpforge/article.md"), "utf8"),
        readFile(
          path.join(root, "content/hello-mpforge/history/state-events.jsonl"),
          "utf8",
        ),
      ]),
    ).resolves.toEqual([expect.stringContaining("slug:"), ""]);
    for (const directory of ["assets", "build", "receipts", "history"])
      expect(
        await readdir(path.join(root, "content/hello-mpforge", directory)),
      ).toBeDefined();
    await expect(
      createArticle(root, { slug: "hello-mpforge" }),
    ).rejects.toMatchObject({ code: "ARTICLE_EXISTS" });
    await expect(
      createArticle(root, {
        slug: "other",
        frontmatter: { id: article.frontmatter.id },
      }),
    ).rejects.toMatchObject({ code: "ARTICLE_ID_EXISTS" });
  });

  it("round-trips unknown typed fields and makes an atomic backup", async () => {
    const original = await createArticle(root, {
      slug: "typed-fields",
      frontmatter: { author: "A", account: "B" },
      now: "2026-09-01T00:00:00.000Z",
    });
    const edited = editRaw(
      original.raw,
      { unknown_object: { enabled: true, count: 2 } },
      "# Updated\n\nBody\n",
    );
    const saved = await saveArticle(root, original.slug, {
      raw: edited,
      expectedHash: original.contentHash,
      now: "2026-09-01T00:01:00.000Z",
    });
    expect(saved.body).toContain("Body");
    expect(saved.frontmatter).toMatchObject({
      version: 2,
      updated_at: "2026-09-01T00:01:00.000Z",
      unknown_object: { enabled: true, count: 2 },
    });
    const backups = await readdir(
      path.join(root, "content/typed-fields/history/backups"),
    );
    expect(backups).toHaveLength(1);
    expect(
      await readFile(
        path.join(root, "content/typed-fields/history/backups", backups[0]!),
        "utf8",
      ),
    ).toBe(original.raw);
    expect(await listRecoveryCandidates(root)).toEqual([]);
  });

  it("opens and safely persists a legacy article using its directory slug", async () => {
    const original = await createArticle(root, { slug: "legacy-directory" });
    const parsed = parseArticleDocument(original.raw);
    delete parsed.frontmatter.slug;
    delete parsed.frontmatter.version;
    const legacyRaw = serializeArticleDocument(parsed);
    await writeFile(original.path, legacyRaw, "utf8");
    const legacy = await openArticle(root, "legacy-directory");
    expect(legacy.frontmatter).toMatchObject({
      slug: "legacy-directory",
      version: 1,
    });
    expect(legacy.migrationChanges).toContain(
      "added slug from article directory",
    );
    const saved = await saveArticle(root, legacy.slug, {
      raw: legacy.raw,
      expectedHash: hashContent(legacyRaw),
      now: "2026-09-01T00:02:00.000Z",
    });
    expect(saved.raw).toContain('slug: "legacy-directory"');
    expect(saved.frontmatter.version).toBe(2);
  });

  it("never overwrites an external edit or invalid editor buffer", async () => {
    const original = await createArticle(root, { slug: "conflict" });
    const articlePath = path.join(root, "content/conflict/article.md");
    const external = editRaw(original.raw, { summary: "external" });
    await writeFile(articlePath, external, "utf8");
    await expect(
      saveArticle(root, "conflict", {
        raw: editRaw(original.raw, { summary: "editor" }),
        expectedHash: original.contentHash,
      }),
    ).rejects.toMatchObject({ code: "ARTICLE_CONFLICT" });
    expect(await readFile(articlePath, "utf8")).toBe(external);

    const current = await openArticle(root, "conflict");
    await expect(
      saveArticle(root, "conflict", {
        raw: "---\ntitle: [broken\n---\nbody",
        expectedHash: current.contentHash,
      }),
    ).rejects.toMatchObject({ code: "ARTICLE_INVALID" });
    expect(await readFile(articlePath, "utf8")).toBe(external);

    await expect(
      saveArticle(root, "conflict", {
        raw: editRaw(current.raw, { status: "approved" }),
        expectedHash: current.contentHash,
      }),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    expect(await readFile(articlePath, "utf8")).toBe(external);
  });

  it("filters and sorts articles by search, status, theme, and update time", async () => {
    const first = await createArticle(root, {
      slug: "first",
      title: "Alpha lesson",
      frontmatter: { theme: "minimal" },
      now: "2026-09-01T00:00:00.000Z",
    });
    await createArticle(root, {
      slug: "second",
      title: "Beta note",
      frontmatter: { theme: "academic-blue" },
      now: "2026-09-01T01:00:00.000Z",
    });
    await transitionArticle(root, first.slug, "draft", {
      actorType: "system",
      actorId: "editor-ui",
      reason: "Started drafting",
      sourceCommit: "abc123",
      now: "2026-09-01T02:00:00.000Z",
    });
    expect((await listArticles(root)).map((item) => item.slug)).toEqual([
      "first",
      "second",
    ]);
    expect((await listArticles(root, { search: "beta" }))[0]?.slug).toBe(
      "second",
    );
    expect((await listArticles(root, { status: "draft" }))[0]?.slug).toBe(
      "first",
    );
    expect(
      (await listArticles(root, { theme: "academic-blue" }))[0]?.slug,
    ).toBe("second");
  });

  it("enforces the Round 1 state machine and writes exact state events", async () => {
    const article = await createArticle(root, { slug: "review-flow" });
    for (const [to, reason] of [
      ["draft", "Draft started"],
      ["reviewing", "Review requested"],
      ["reviewed", "Review completed"],
    ] as const) {
      await transitionArticle(root, article.slug, to, {
        actorType: "automation",
        actorId: "workflow",
        reason,
        sourceCommit: "deadbeef",
        now: `2026-09-01T00:0${to.length}:00.000Z`,
      });
    }
    await expect(
      transitionArticle(root, article.slug, "approved", {
        actorType: "automation",
        actorId: "workflow",
        reason: "Must be blocked",
        sourceCommit: "deadbeef",
      }),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    await expect(
      transitionArticle(root, article.slug, "approved", {
        actorType: "human",
        actorId: "reviewer",
        reason: "Missing explicit confirmation",
        sourceCommit: "deadbeef",
      }),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    const approved = await transitionArticle(root, article.slug, "approved", {
      actorType: "human",
      actorId: "reviewer",
      reason: "Reviewed exact rendered version",
      sourceCommit: "deadbeef",
      explicitHumanAction: true,
      now: "2026-09-01T00:10:00.000Z",
    });
    expect(approved.article.frontmatter).toMatchObject({
      status: "approved",
      human_reviewed: true,
    });
    await expect(
      transitionArticle(root, article.slug, "sent_to_draft", {
        actorType: "system",
        actorId: "adapter",
        reason: "Round 1 keeps this closed",
        sourceCommit: "deadbeef",
      }),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    const historyRaw = await readFile(
      path.join(root, "content/review-flow/history/state-events.jsonl"),
      "utf8",
    );
    const history = parseStateEvents(historyRaw);
    expect(history.errors).toEqual([]);
    expect(history.events).toHaveLength(4);
    expect(history.events[3]).toEqual({
      event_id: expect.any(String),
      article_id: article.frontmatter.id,
      from_status: "reviewed",
      to_status: "approved",
      actor_type: "human",
      actor_id: "reviewer",
      reason: "Reviewed exact rendered version",
      created_at: "2026-09-01T00:10:00.000Z",
      source_commit: "deadbeef",
    });
  });

  it("refuses to mutate an article whose state history is corrupt", async () => {
    const article = await createArticle(root, { slug: "corrupt-history" });
    await writeFile(
      path.join(root, "content/corrupt-history/history/state-events.jsonl"),
      "not-json\n",
      "utf8",
    );
    await expect(
      transitionArticle(root, article.slug, "draft", {
        actorType: "human",
        actorId: "editor",
        reason: "Should not pass corrupt history",
        sourceCommit: "abc123",
      }),
    ).rejects.toMatchObject({ code: "ARTICLE_INVALID" });
    expect((await openArticle(root, article.slug)).frontmatter.status).toBe(
      "idea",
    );
  });

  it("moves deletion into the project trash and restores without overwrite", async () => {
    await createArticle(root, { slug: "recoverable" });
    const trashed = await trashArticle(
      root,
      "recoverable",
      new Date("2026-09-01T03:00:00.000Z"),
    );
    await expect(openArticle(root, "recoverable")).rejects.toMatchObject({
      code: "ARTICLE_NOT_FOUND",
    });
    expect(await listTrash(root)).toEqual([trashed]);
    expect((await restoreArticle(root, trashed.id)).slug).toBe("recoverable");
    expect(await listTrash(root)).toEqual([]);
  });
});

describe("autosave controller", () => {
  it("debounces, reports states, and retains the buffer after failure", async () => {
    vi.useFakeTimers();
    const states: string[] = [];
    const persist = vi
      .fn<(content: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValue(undefined);
    const autosave = new AutosaveController(persist, 250, (state) =>
      states.push(state),
    );
    autosave.update("first");
    autosave.update("latest");
    await vi.advanceTimersByTimeAsync(250);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith("latest");
    expect(autosave.currentState).toBe("failed");
    expect(autosave.hasUnsavedChanges()).toBe(true);
    expect(autosave.beforeUnloadMessage()).toMatch(/unsaved/);
    await autosave.flush();
    expect(autosave.currentState).toBe("saved");
    expect(autosave.hasUnsavedChanges()).toBe(false);
    expect(states).toEqual([
      "dirty",
      "dirty",
      "saving",
      "failed",
      "saving",
      "saved",
    ]);
  });
});

describe("recovery candidates", () => {
  it("recovers only a validated temp file against the expected disk hash", async () => {
    const original = await createArticle(root, { slug: "temp-recovery" });
    const temporaryRoot = path.join(root, "tmp/content-store");
    await mkdir(temporaryRoot, { recursive: true });
    const raw = editRaw(original.raw, { summary: "recovered" });
    const temporaryPath = path.join(
      temporaryRoot,
      "temp-recovery.crashed-process.tmp",
    );
    await writeFile(temporaryPath, raw, "utf8");
    const lockDirectory = path.join(temporaryRoot, "locks");
    const staleLock = path.join(lockDirectory, "temp-recovery.lock");
    await mkdir(lockDirectory, { recursive: true });
    await writeFile(staleLock, "crashed", "utf8");
    await utimes(staleLock, new Date(0), new Date(0));
    const [candidate] = await listRecoveryCandidates(root);
    expect(candidate).toMatchObject({
      slug: "temp-recovery",
      contentHash: hashContent(raw),
    });
    const recovered = await import("./index.js").then(({ recoverArticle }) =>
      recoverArticle(root, candidate!, original.contentHash),
    );
    expect(recovered.frontmatter.summary).toBe("recovered");
    expect(await listRecoveryCandidates(root)).toEqual([]);
  });
});

it("exposes typed store errors", () => {
  expect(new ContentStoreError("ARTICLE_CONFLICT", "conflict")).toMatchObject({
    code: "ARTICLE_CONFLICT",
    message: "conflict",
  });
});
