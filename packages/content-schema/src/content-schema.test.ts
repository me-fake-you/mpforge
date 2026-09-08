import { describe, expect, it } from "vitest";
import {
  appendAudit,
  articlePaths,
  buildArticleDocument,
  createDefaultFrontmatter,
  generateSlug,
  migrateFrontmatter,
  parseArticleDocument,
  parseAudit,
  patchArticleDocument,
  recommendStatusTransition,
  replayAudit,
  serializeArticleDocument,
  serializeAudit,
  transitionStatus,
  validateStateEventChain,
  validateFrontmatter,
  type ArticleStatus,
  type AuditEvent,
  type FrontmatterValue,
} from "./index.js";

const human = { kind: "human" as const, id: "editor" };
const system = { kind: "system" as const, id: "test" };
const ai = { kind: "ai" as const, id: "reviewer" };

function canonical(overrides: Record<string, unknown> = {}) {
  return createDefaultFrontmatter({
    id: "article-1",
    title: "测试文章",
    author: "作者",
    account: "demo",
    ...overrides,
  });
}

describe("article paths", () => {
  it("builds the portable content-as-code layout", () => {
    expect(articlePaths("hello-world")).toEqual({
      slug: "hello-world",
      directory: "content/hello-world",
      article: "content/hello-world/article.md",
      history: "content/hello-world/history",
      stateEvents: "content/hello-world/history/state-events.jsonl",
      audit: "content/hello-world/history/state-events.jsonl",
      assets: "content/hello-world/assets",
      build: "content/hello-world/build",
      receipts: "content/hello-world/receipts",
    });
  });

  it("rejects path traversal in article slugs", () => {
    expect(() => articlePaths("../secret")).toThrow();
    expect(() => articlePaths("a/b")).toThrow();
    expect(() => articlePaths("a\\b")).toThrow();
    expect(() => articlePaths(".hidden")).toThrow();
    expect(() => articlePaths("CON")).toThrow();
    expect(() => articlePaths("bad:name")).toThrow();
    expect(() => articlePaths("trailing.")).toThrow();
  });

  it("generates deterministic safe slugs", () => {
    expect(generateSlug("Hello, MPForge! ")).toBe("hello-mpforge");
    expect(generateSlug("公众号文章")).toMatch(/^article-[a-z0-9]+$/);
    expect(generateSlug("公众号文章")).toBe(generateSlug("公众号文章"));
  });
});

describe("frontmatter", () => {
  it("serializes and validates every MPForge field", () => {
    const value = canonical({
      summary: "摘要",
      cover: "assets/cover.png",
      source_url: "https://example.test/source",
      original: false,
      ai_assisted: true,
      ai_tasks: ["润色"],
      human_reviewed: true,
      need_open_comment: false,
      only_fans_can_comment: true,
      status: "reviewed",
      custom_field: "kept",
    });
    const parsed = parseArticleDocument(buildArticleDocument(value, "正文"));
    expect(validateFrontmatter(parsed.frontmatter)).toMatchObject({
      valid: true,
    });
    expect(parsed.frontmatter).toMatchObject({
      id: "article-1",
      title: "测试文章",
      summary: "摘要",
      account: "demo",
      status: "reviewed",
      ai_tasks: ["润色"],
      custom_field: "kept",
    });
  });

  it("preserves unknown fields, BOM, and CRLF", () => {
    const source =
      '\uFEFF---\r\nid: "one"\r\ntitle: "标题"\r\nstatus: idea\r\nunknown: "value"\r\n---\r\n\r\n正文';
    const parsed = parseArticleDocument(source);
    expect(parsed.hasBom).toBe(true);
    expect(parsed.lineEnding).toBe("\r\n");
    expect(parsed.frontmatter.unknown).toBe("value");
    const patched = patchArticleDocument(source, { status: "draft" });
    expect(patched.startsWith("\uFEFF---\r\n")).toBe(true);
    expect(patched).toContain('unknown: "value"');
    expect(patched).toContain('status: "draft"');
    expect(patched).toContain("\r\n");
  });

  it("preserves intentional leading whitespace in the article body", () => {
    const body = "\n  indented opening\n\nBody";
    const source = buildArticleDocument(canonical(), body);
    expect(parseArticleDocument(source).body).toBe(body);
  });

  it("treats files without frontmatter as legacy draft-compatible content", () => {
    const parsed = parseArticleDocument("# Legacy\n\nBody");
    expect(parsed.legacy).toBe(true);
    expect(parsed.body).toBe("# Legacy\n\nBody");
    expect(validateFrontmatter(parsed.frontmatter).valid).toBe(false);
  });

  it("does not duplicate a BOM on legacy documents", () => {
    const source = "\uFEFF# Legacy\r\n\r\nBody";
    const parsed = parseArticleDocument(source);
    expect(parsed.body.startsWith("\uFEFF")).toBe(false);
    expect(serializeArticleDocument(parsed)).toBe("\uFEFF# Legacy\r\n\r\nBody");
  });

  it("reports invalid required field types", () => {
    const result = validateFrontmatter({ ...canonical(), original: "yes" });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("original must be a boolean");
  });

  it("parses block arrays and preserves date strings as strings", () => {
    const parsed = parseArticleDocument(
      "---\nai_tasks:\n  - outline\n  - proofreading\ncreated_at: 2026-08-31\n---\nbody",
    );
    expect(parsed.frontmatter.ai_tasks).toEqual(["outline", "proofreading"]);
    expect(parsed.frontmatter.created_at).toBe("2026-08-31");
    expect(typeof parsed.frontmatter.created_at).toBe("string");
  });

  it("reports malformed YAML instead of silently dropping it", () => {
    expect(() =>
      parseArticleDocument("---\ntitle: [broken\n---\nbody"),
    ).toThrow(/Invalid YAML frontmatter at line 1/);
    expect(() =>
      parseArticleDocument("---\ntitle: one\ntitle: two\n---\nbody"),
    ).toThrow(/duplicate key title/);
    expect(() => parseArticleDocument("---\ntitle: unfinished\nbody")).toThrow(
      /missing closing --- delimiter/,
    );
  });

  it("migrates legacy records while preserving unknown typed fields", () => {
    const legacy: Record<string, FrontmatterValue | undefined> = canonical({
      slug: undefined,
      version: undefined,
      schema_version: undefined,
      custom_flags: [true, 2, "three"],
    });
    delete legacy.slug;
    delete legacy.version;
    delete legacy.schema_version;
    const migrated = migrateFrontmatter(legacy);
    expect(migrated.value).toMatchObject({
      slug: "article-1",
      version: 1,
      schema_version: 1,
      custom_flags: [true, 2, "three"],
    });
    const roundTrip = parseArticleDocument(
      buildArticleDocument(migrated.value, "body"),
    );
    expect(roundTrip.frontmatter.custom_flags).toEqual([true, 2, "three"]);
  });
});

describe("status machine", () => {
  const legal: Array<[ArticleStatus, ArticleStatus]> = [
    ["idea", "draft"],
    ["draft", "reviewing"],
    ["reviewing", "draft"],
    ["reviewing", "reviewed"],
    ["reviewed", "draft"],
    ["reviewed", "approved"],
    ["approved", "draft"],
    ["approved", "reviewed"],
  ];

  it.each(legal)("allows %s -> %s", (from, to) => {
    const actor = to === "approved" ? human : system;
    const result = transitionStatus(from, to, {
      actor,
      explicitHumanAction: to === "approved",
      timestamp: "2026-08-31T00:00:00.000Z",
      eventId: `${from}-${to}`,
    });
    expect(result.ok).toBe(true);
    expect(result.auditEvent).toMatchObject({
      action: "status.changed",
      from_status: from,
      to_status: to,
    });
  });

  it("rejects every non-edge transition", () => {
    const statuses: ArticleStatus[] = [
      "idea",
      "draft",
      "reviewing",
      "reviewed",
      "approved",
      "sent_to_draft",
      "published",
      "failed",
    ];
    for (const from of statuses) {
      for (const to of statuses) {
        if (from === to || legal.some(([a, b]) => a === from && b === to))
          continue;
        expect(transitionStatus(from, to, { actor: human }).ok).toBe(false);
      }
    }
  });

  it("requires a human to approve and prevents AI from changing status", () => {
    expect(transitionStatus("reviewed", "approved", { actor: ai }).error).toBe(
      "approval_requires_human",
    );
    expect(
      transitionStatus("reviewed", "approved", { actor: system }).error,
    ).toBe("approval_requires_human");
    expect(
      transitionStatus("reviewed", "approved", {
        actor: human,
      }).ok,
    ).toBe(true);
    expect(transitionStatus("draft", "reviewing", { actor: ai }).error).toBe(
      "ai_may_only_recommend",
    );
    expect(
      recommendStatusTransition("draft", "reviewing", {
        actor: ai,
        eventId: "recommend-1",
      }),
    ).toMatchObject({
      from: "draft",
      to: "reviewing",
      auditEvent: { action: "review.recommended" },
    });
  });

  it("keeps delivery and publication states closed in Round 1", () => {
    expect(
      transitionStatus("reviewed", "sent_to_draft", { actor: human }).error,
    ).toBe("draft_submission_requires_approval");
    expect(
      transitionStatus("approved", "sent_to_draft", { actor: system }).ok,
    ).toBe(false);
    expect(
      transitionStatus("sent_to_draft", "published", { actor: system }).ok,
    ).toBe(false);
  });
});

describe("audit log", () => {
  function event(
    from_status: ArticleStatus,
    to_status: ArticleStatus,
    id: string,
  ): AuditEvent {
    return {
      schema: "mpforge.audit/v1",
      id,
      timestamp: "2026-08-31T00:00:00.000Z",
      actor: human,
      action: "status.changed",
      from_status,
      to_status,
    };
  }

  it("round-trips JSONL and replays status", () => {
    const events = [
      event("idea", "draft", "1"),
      event("draft", "reviewing", "2"),
    ];
    const raw = serializeAudit(events);
    expect(parseAudit(raw)).toMatchObject({ events, errors: [] });
    expect(replayAudit("idea", raw)).toMatchObject({
      status: "reviewing",
      valid: true,
      events,
    });
    expect(appendAudit(raw, event("reviewing", "reviewed", "3"))).toContain(
      '"id":"3"',
    );
  });

  it("detects a broken audit chain and malformed entries", () => {
    const result = replayAudit(
      "idea",
      `${JSON.stringify(event("draft", "reviewing", "bad"))}\nnot-json\n`,
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes("expected idea"))).toBe(
      true,
    );
    expect(result.errors.some((error) => error.includes("Audit line 2"))).toBe(
      true,
    );
  });

  it("validates canonical state-event history and explicit human approval", () => {
    const common = {
      article_id: "article-1",
      actor_id: "editor",
      reason: "review action",
      created_at: "2026-09-01T00:00:00.000Z",
      source_commit: "abc123",
    };
    const result = validateStateEventChain([
      {
        ...common,
        event_id: "state-1",
        from_status: "idea",
        to_status: "draft",
        actor_type: "automation",
      },
      {
        ...common,
        event_id: "state-2",
        from_status: "draft",
        to_status: "reviewing",
        actor_type: "human",
      },
      {
        ...common,
        event_id: "state-3",
        from_status: "reviewing",
        to_status: "reviewed",
        actor_type: "human",
      },
      {
        ...common,
        event_id: "state-4",
        from_status: "reviewed",
        to_status: "approved",
        actor_type: "human",
      },
    ]);
    expect(result).toEqual({ valid: true, status: "approved", errors: [] });
  });
});
