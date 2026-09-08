import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { watch, type FSWatcher } from "node:fs";
import path from "node:path";
import {
  ArticleSchema,
  articlePaths,
  assertValidSlug,
  buildArticleDocument,
  createDefaultFrontmatter,
  generateSlug,
  migrateFrontmatter,
  parseArticleDocument,
  parseStateEvents,
  serializeArticleDocument,
  serializeStateEvents,
  transitionStatus,
  validateStateEventChain,
  type ActorKind,
  type ArticleFrontmatter,
  type ArticleStatus,
  type FrontmatterValue,
  type StateEvent,
} from "@mpforge/content-schema";

export type ContentStoreErrorCode =
  | "ARTICLE_EXISTS"
  | "ARTICLE_NOT_FOUND"
  | "ARTICLE_CONFLICT"
  | "ARTICLE_LOCKED"
  | "ARTICLE_INVALID"
  | "ARTICLE_ID_EXISTS"
  | "ARTICLE_ID_IMMUTABLE"
  | "SLUG_MISMATCH"
  | "INVALID_TRANSITION"
  | "TRASH_ITEM_NOT_FOUND"
  | "UNSAFE_PATH";

export class ContentStoreError extends Error {
  constructor(
    readonly code: ContentStoreErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ContentStoreError";
  }
}

export interface StoredArticle {
  slug: string;
  path: string;
  raw: string;
  body: string;
  frontmatter: ArticleFrontmatter;
  contentHash: string;
  mtimeMs: number;
  migrationChanges: string[];
}

export interface CreateArticleInput {
  slug?: string;
  title?: string;
  body?: string;
  frontmatter?: Partial<ArticleFrontmatter> &
    Record<string, FrontmatterValue | undefined>;
  now?: string;
}

export interface SaveArticleInput {
  raw: string;
  expectedHash: string;
  now?: string;
}

export interface ListArticleOptions {
  search?: string;
  status?: ArticleStatus;
  theme?: string;
}

export interface TrashEntry {
  id: string;
  slug: string;
  path: string;
  deletedAt: string;
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function workspacePath(root: string, ...segments: string[]): string {
  const resolvedRoot = path.resolve(root);
  const absolute = path.resolve(resolvedRoot, ...segments);
  const relative = path.relative(resolvedRoot, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new ContentStoreError("UNSAFE_PATH", "Path escapes the workspace");
  return absolute;
}

function nativeArticlePaths(root: string, slug: string) {
  const portable = articlePaths(slug);
  const resolve = (value: string) => workspacePath(root, ...value.split("/"));
  return {
    directory: resolve(portable.directory),
    article: resolve(portable.article),
    assets: resolve(portable.assets),
    build: resolve(portable.build),
    receipts: resolve(portable.receipts),
    history: resolve(portable.history),
    stateEvents: resolve(portable.stateEvents),
  };
}

function migrateForSlug(
  frontmatter: Record<string, FrontmatterValue | undefined>,
  slug: string,
) {
  const hadSlug =
    typeof frontmatter.slug === "string" && Boolean(frontmatter.slug);
  const migration = migrateFrontmatter({
    ...frontmatter,
    ...(!hadSlug ? { slug } : {}),
  });
  if (!hadSlug) migration.changes.unshift("added slug from article directory");
  return migration;
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function fsyncDirectory(directory: string): Promise<void> {
  try {
    const handle = await open(directory, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    // Windows cannot fsync a directory. The file itself has already been synced.
    if (process.platform !== "win32") throw error;
  }
}

let temporarySequence = 0;

async function atomicWrite(
  root: string,
  slug: string,
  destination: string,
  content: string,
): Promise<string> {
  const temporaryRoot = workspacePath(root, "tmp", "content-store");
  await mkdir(temporaryRoot, { recursive: true });
  temporarySequence += 1;
  const temporary = path.join(
    temporaryRoot,
    `${slug}.${process.pid}.${Date.now()}.${temporarySequence}.tmp`,
  );
  const handle = await open(temporary, "wx");
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, destination);
    await fsyncDirectory(path.dirname(destination));
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  return temporary;
}

async function acquireLock(
  root: string,
  slug: string,
): Promise<() => Promise<void>> {
  const lockRoot = workspacePath(root, "tmp", "content-store", "locks");
  await mkdir(lockRoot, { recursive: true });
  const lockPath = path.join(lockRoot, `${slug}.lock`);
  try {
    const handle = await open(lockPath, "wx");
    await handle.writeFile(
      JSON.stringify({
        pid: process.pid,
        created_at: new Date().toISOString(),
      }),
      "utf8",
    );
    await handle.close();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      if (await clearStaleArticleLock(root, slug))
        return acquireLock(root, slug);
      throw new ContentStoreError(
        "ARTICLE_LOCKED",
        `Article is already being saved: ${slug}`,
      );
    }
    throw error;
  }
  return async () => unlink(lockPath).catch(() => undefined);
}

/** Remove only an old project-local lock left behind by an abnormal exit. */
export async function clearStaleArticleLock(
  root: string,
  rawSlug: string,
  options: { nowMs?: number; staleAfterMs?: number } = {},
): Promise<boolean> {
  const slug = assertValidSlug(rawSlug);
  const lockPath = workspacePath(
    root,
    "tmp",
    "content-store",
    "locks",
    `${slug}.lock`,
  );
  let lockStat;
  try {
    lockStat = await stat(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  const nowMs = options.nowMs ?? Date.now();
  const staleAfterMs = options.staleAfterMs ?? 5 * 60_000;
  if (staleAfterMs < 0 || nowMs - lockStat.mtimeMs < staleAfterMs) return false;
  await unlink(lockPath);
  return true;
}

async function assertUniqueArticleId(
  root: string,
  id: string,
  currentSlug?: string,
): Promise<void> {
  const articles = await listArticles(root);
  const duplicate = articles.find(
    (article) => article.frontmatter.id === id && article.slug !== currentSlug,
  );
  if (duplicate)
    throw new ContentStoreError(
      "ARTICLE_ID_EXISTS",
      `Article id already belongs to ${duplicate.slug}`,
      { id, slug: duplicate.slug },
    );
}

export async function openArticle(
  root: string,
  rawSlug: string,
): Promise<StoredArticle> {
  const slug = assertValidSlug(rawSlug);
  const paths = nativeArticlePaths(root, slug);
  let raw: string;
  let fileStat;
  try {
    [raw, fileStat] = await Promise.all([
      readFile(paths.article, "utf8"),
      stat(paths.article),
    ]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new ContentStoreError(
        "ARTICLE_NOT_FOUND",
        `Article does not exist: ${slug}`,
      );
    throw error;
  }
  let parsed;
  try {
    parsed = parseArticleDocument(raw);
  } catch (error) {
    throw new ContentStoreError(
      "ARTICLE_INVALID",
      error instanceof Error ? error.message : String(error),
    );
  }
  let migration;
  try {
    migration = migrateForSlug(parsed.frontmatter, slug);
  } catch (error) {
    throw new ContentStoreError(
      "ARTICLE_INVALID",
      error instanceof Error ? error.message : String(error),
    );
  }
  const validation = ArticleSchema.safeParse(migration.value);
  if (!validation.success || !validation.data)
    throw new ContentStoreError(
      "ARTICLE_INVALID",
      validation.errors.join("; "),
      { errors: validation.errors },
    );
  if (validation.data.slug !== slug)
    throw new ContentStoreError(
      "SLUG_MISMATCH",
      `Frontmatter slug ${validation.data.slug} does not match ${slug}`,
    );
  return {
    slug,
    path: paths.article,
    raw,
    body: parsed.body,
    frontmatter: validation.data,
    contentHash: hashContent(raw),
    mtimeMs: fileStat.mtimeMs,
    migrationChanges: migration.changes,
  };
}

export async function createArticle(
  root: string,
  input: CreateArticleInput,
): Promise<StoredArticle> {
  const requested = input.slug || input.title || "article";
  const slug = generateSlug(requested);
  const paths = nativeArticlePaths(root, slug);
  const now = input.now || new Date().toISOString();
  const id = input.frontmatter?.id || randomUUID();
  await assertUniqueArticleId(root, id);
  await mkdir(workspacePath(root, "content"), { recursive: true });
  try {
    await mkdir(paths.directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new ContentStoreError(
        "ARTICLE_EXISTS",
        `Article already exists: ${slug}`,
      );
    throw error;
  }
  try {
    await Promise.all([
      mkdir(paths.assets),
      mkdir(paths.build),
      mkdir(paths.receipts),
      mkdir(paths.history),
    ]);
    const frontmatter = createDefaultFrontmatter(
      {
        ...input.frontmatter,
        id,
        slug,
        title: input.title || input.frontmatter?.title || slug,
        status: "idea",
        human_reviewed: false,
        created_at: now,
        updated_at: now,
        version: 1,
      },
      now,
    );
    ArticleSchema.parse(frontmatter);
    const raw = buildArticleDocument(
      frontmatter,
      input.body ?? `# ${frontmatter.title}\n\n`,
    );
    await atomicWrite(root, slug, paths.article, raw);
    await writeFile(paths.stateEvents, "", { encoding: "utf8", flag: "wx" });
    return await openArticle(root, slug);
  } catch (error) {
    await rm(paths.directory, { recursive: true, force: true });
    throw error;
  }
}

async function backupArticle(
  root: string,
  article: StoredArticle,
): Promise<string> {
  const paths = nativeArticlePaths(root, article.slug);
  const backupDirectory = path.join(paths.history, "backups");
  await mkdir(backupDirectory, { recursive: true });
  const backup = path.join(
    backupDirectory,
    `${Date.now()}-${article.contentHash.slice(0, 12)}.md`,
  );
  await copyFile(paths.article, backup);
  return backup;
}

export async function saveArticle(
  root: string,
  rawSlug: string,
  input: SaveArticleInput,
): Promise<StoredArticle> {
  return saveArticleInternal(root, rawSlug, input);
}

async function saveArticleInternal(
  root: string,
  rawSlug: string,
  input: SaveArticleInput,
  permittedTransition?: { from: ArticleStatus; to: ArticleStatus },
): Promise<StoredArticle> {
  const slug = assertValidSlug(rawSlug);
  const release = await acquireLock(root, slug);
  try {
    const current = await openArticle(root, slug);
    if (current.contentHash !== input.expectedHash)
      throw new ContentStoreError(
        "ARTICLE_CONFLICT",
        "Article changed on disk; editor content was not overwritten",
        { expectedHash: input.expectedHash, actualHash: current.contentHash },
      );
    let parsed;
    try {
      parsed = parseArticleDocument(input.raw);
    } catch (error) {
      throw new ContentStoreError(
        "ARTICLE_INVALID",
        error instanceof Error ? error.message : String(error),
      );
    }
    const migration = migrateForSlug(parsed.frontmatter, slug);
    if (migration.value.slug !== slug)
      throw new ContentStoreError(
        "SLUG_MISMATCH",
        `Frontmatter slug ${migration.value.slug} does not match ${slug}`,
      );
    if (migration.value.id !== current.frontmatter.id)
      throw new ContentStoreError(
        "ARTICLE_ID_IMMUTABLE",
        "Article id cannot change after creation",
      );
    if (
      migration.value.status !== current.frontmatter.status &&
      (!permittedTransition ||
        permittedTransition.from !== current.frontmatter.status ||
        permittedTransition.to !== migration.value.status)
    )
      throw new ContentStoreError(
        "INVALID_TRANSITION",
        "Status changes must use transitionArticle",
        {
          from: current.frontmatter.status,
          to: migration.value.status,
        },
      );
    await assertUniqueArticleId(root, migration.value.id, slug);
    const now = input.now || new Date().toISOString();
    const nextFrontmatter = ArticleSchema.parse({
      ...migration.value,
      created_at: current.frontmatter.created_at,
      updated_at: now,
      version: current.frontmatter.version + 1,
    });
    const nextRaw = serializeArticleDocument({
      ...parsed,
      frontmatter: nextFrontmatter,
    });
    const justBeforeWrite = await readFile(current.path, "utf8");
    if (hashContent(justBeforeWrite) !== input.expectedHash)
      throw new ContentStoreError(
        "ARTICLE_CONFLICT",
        "Article changed on disk during save; editor content was preserved",
      );
    await backupArticle(root, current);
    await atomicWrite(root, slug, current.path, nextRaw);
    return await openArticle(root, slug);
  } finally {
    await release();
  }
}

export async function listArticles(
  root: string,
  options: ListArticleOptions = {},
): Promise<StoredArticle[]> {
  const contentRoot = workspacePath(root, "content");
  let entries;
  try {
    entries = await readdir(contentRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const articles: StoredArticle[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const article = await openArticle(root, entry.name);
      const query = options.search?.trim().toLocaleLowerCase();
      if (
        query &&
        !`${article.slug} ${article.frontmatter.title} ${article.frontmatter.summary}`
          .toLocaleLowerCase()
          .includes(query)
      )
        continue;
      if (options.status && article.frontmatter.status !== options.status)
        continue;
      if (options.theme && article.frontmatter.theme !== options.theme)
        continue;
      articles.push(article);
    } catch (error) {
      if (
        error instanceof ContentStoreError &&
        (error.code === "ARTICLE_INVALID" || error.code === "SLUG_MISMATCH")
      )
        continue;
      throw error;
    }
  }
  return articles.sort((a, b) =>
    b.frontmatter.updated_at.localeCompare(a.frontmatter.updated_at),
  );
}

export async function transitionArticle(
  root: string,
  rawSlug: string,
  to: ArticleStatus,
  input: {
    actorType: ActorKind;
    actorId: string;
    reason: string;
    sourceCommit: string;
    explicitHumanAction?: boolean;
    now?: string;
  },
): Promise<{ article: StoredArticle; event: StateEvent }> {
  const slug = assertValidSlug(rawSlug);
  if (
    !input.actorId.trim() ||
    !input.reason.trim() ||
    !input.sourceCommit.trim()
  )
    throw new ContentStoreError(
      "INVALID_TRANSITION",
      "actorId, reason, and sourceCommit are required",
    );
  const current = await openArticle(root, slug);
  if (to === "approved" && input.explicitHumanAction !== true)
    throw new ContentStoreError(
      "INVALID_TRANSITION",
      "Transition blocked: approval_requires_explicit_human_action",
      {
        from: current.frontmatter.status,
        to,
        error: "approval_requires_explicit_human_action",
      },
    );
  const result = transitionStatus(current.frontmatter.status, to, {
    actor: { kind: input.actorType, id: input.actorId },
    explicitHumanAction: input.explicitHumanAction,
    timestamp: input.now,
  });
  if (!result.ok)
    throw new ContentStoreError(
      "INVALID_TRANSITION",
      `Transition blocked: ${result.error}`,
      { from: current.frontmatter.status, to, error: result.error },
    );
  const now = input.now || new Date().toISOString();
  const parsed = parseArticleDocument(current.raw);
  const nextRaw = serializeArticleDocument({
    ...parsed,
    frontmatter: {
      ...parsed.frontmatter,
      status: to,
      ...(to === "approved"
        ? { human_reviewed: true }
        : current.frontmatter.status === "approved"
          ? { human_reviewed: false }
          : {}),
    },
  });
  const paths = nativeArticlePaths(root, slug);
  const existing = await readFile(paths.stateEvents, "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    },
  );
  const parsedEvents = parseStateEvents(existing);
  const chain = validateStateEventChain(parsedEvents.events);
  if (
    parsedEvents.errors.length ||
    !chain.valid ||
    chain.status !== current.frontmatter.status
  )
    throw new ContentStoreError(
      "ARTICLE_INVALID",
      `State event history is invalid: ${[
        ...parsedEvents.errors,
        ...chain.errors,
        ...(chain.status !== current.frontmatter.status
          ? [
              `history ends at ${chain.status}, article is ${current.frontmatter.status}`,
            ]
          : []),
      ].join("; ")}`,
    );
  const article = await saveArticleInternal(
    root,
    slug,
    {
      raw: nextRaw,
      expectedHash: current.contentHash,
      now,
    },
    { from: current.frontmatter.status, to },
  );
  const event: StateEvent = {
    event_id: result.auditEvent?.id || randomUUID(),
    article_id: article.frontmatter.id,
    from_status: current.frontmatter.status,
    to_status: to,
    actor_type: input.actorType,
    actor_id: input.actorId,
    reason: input.reason,
    created_at: now,
    source_commit: input.sourceCommit,
  };
  await atomicWrite(
    root,
    slug,
    paths.stateEvents,
    serializeStateEvents([...parsedEvents.events, event]),
  );
  return { article, event };
}

const TRASH_PATTERN = /^(?<slug>[a-z0-9]+(?:-[a-z0-9]+)*)--(?<time>\d+)$/;

export async function trashArticle(
  root: string,
  rawSlug: string,
  now = new Date(),
): Promise<TrashEntry> {
  const slug = assertValidSlug(rawSlug);
  const paths = nativeArticlePaths(root, slug);
  if (!(await exists(paths.article)))
    throw new ContentStoreError(
      "ARTICLE_NOT_FOUND",
      `Article does not exist: ${slug}`,
    );
  const trashRoot = workspacePath(root, ".trash", "articles");
  await mkdir(trashRoot, { recursive: true });
  const id = `${slug}--${now.getTime()}`;
  const destination = path.join(trashRoot, id);
  await rename(paths.directory, destination);
  return {
    id,
    slug,
    path: destination,
    deletedAt: now.toISOString(),
  };
}

export async function listTrash(root: string): Promise<TrashEntry[]> {
  const trashRoot = workspacePath(root, ".trash", "articles");
  let entries;
  try {
    entries = await readdir(trashRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return entries.flatMap((entry) => {
    if (!entry.isDirectory()) return [];
    const match = TRASH_PATTERN.exec(entry.name);
    if (!match?.groups) return [];
    const milliseconds = Number(match.groups.time);
    return [
      {
        id: entry.name,
        slug: match.groups.slug!,
        path: path.join(trashRoot, entry.name),
        deletedAt: new Date(milliseconds).toISOString(),
      },
    ];
  });
}

export async function restoreArticle(
  root: string,
  trashId: string,
): Promise<StoredArticle> {
  const entry = (await listTrash(root)).find((item) => item.id === trashId);
  if (!entry)
    throw new ContentStoreError(
      "TRASH_ITEM_NOT_FOUND",
      `Trash item does not exist: ${trashId}`,
    );
  const destination = nativeArticlePaths(root, entry.slug).directory;
  if (await exists(destination))
    throw new ContentStoreError(
      "ARTICLE_EXISTS",
      `Cannot restore over existing article: ${entry.slug}`,
    );
  await mkdir(path.dirname(destination), { recursive: true });
  await rename(entry.path, destination);
  return await openArticle(root, entry.slug);
}

export interface RecoveryCandidate {
  path: string;
  slug: string;
  contentHash: string;
}

export async function listRecoveryCandidates(
  root: string,
): Promise<RecoveryCandidate[]> {
  const temporaryRoot = workspacePath(root, "tmp", "content-store");
  let entries;
  try {
    entries = await readdir(temporaryRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const candidates: RecoveryCandidate[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".tmp")) continue;
    const slug = entry.name.split(".")[0]!;
    try {
      assertValidSlug(slug);
      const candidatePath = path.join(temporaryRoot, entry.name);
      const raw = await readFile(candidatePath, "utf8");
      const parsed = parseArticleDocument(raw);
      ArticleSchema.parse(migrateForSlug(parsed.frontmatter, slug).value);
      candidates.push({
        path: candidatePath,
        slug,
        contentHash: hashContent(raw),
      });
    } catch {
      // Invalid temp files are retained for manual inspection, never auto-applied.
    }
  }
  return candidates;
}

export async function recoverArticle(
  root: string,
  candidate: RecoveryCandidate,
  expectedHash: string,
): Promise<StoredArticle> {
  const temporaryRoot = workspacePath(root, "tmp", "content-store");
  const relative = path.relative(temporaryRoot, path.resolve(candidate.path));
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new ContentStoreError("UNSAFE_PATH", "Recovery file is outside tmp");
  const raw = await readFile(candidate.path, "utf8");
  if (hashContent(raw) !== candidate.contentHash)
    throw new ContentStoreError(
      "ARTICLE_CONFLICT",
      "Recovery file changed after it was inspected",
    );
  const article = await saveArticle(root, candidate.slug, {
    raw,
    expectedHash,
  });
  await unlink(candidate.path);
  return article;
}

export function watchContent(
  root: string,
  onChange: (event: { eventType: string; filename: string | null }) => void,
): FSWatcher {
  const contentRoot = workspacePath(root, "content");
  return watch(contentRoot, { recursive: true }, (eventType, filename) =>
    onChange({ eventType, filename: filename?.toString() ?? null }),
  );
}

export type AutosaveState = "idle" | "dirty" | "saving" | "saved" | "failed";

export class AutosaveController {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: string | undefined;
  private inFlight: Promise<void> | undefined;
  private state: AutosaveState = "idle";

  constructor(
    private readonly persist: (content: string) => Promise<void>,
    private readonly delayMs = 750,
    private readonly onState: (
      state: AutosaveState,
      error?: unknown,
    ) => void = () => undefined,
  ) {}

  get currentState(): AutosaveState {
    return this.state;
  }

  update(content: string): void {
    this.pending = content;
    this.setState("dirty");
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.delayMs);
  }

  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.inFlight) {
      await this.inFlight;
      if (this.pending !== undefined) await this.flush();
      return;
    }
    const content = this.pending;
    if (content === undefined) return;
    this.inFlight = this.persistOnce(content);
    await this.inFlight;
    this.inFlight = undefined;
  }

  hasUnsavedChanges(): boolean {
    return this.pending !== undefined || this.state === "saving";
  }

  beforeUnloadMessage(): string | undefined {
    return this.hasUnsavedChanges()
      ? "This article has unsaved local changes."
      : undefined;
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private setState(state: AutosaveState, error?: unknown): void {
    this.state = state;
    this.onState(state, error);
  }

  private async persistOnce(content: string): Promise<void> {
    this.setState("saving");
    try {
      await this.persist(content);
      if (this.pending === content) this.pending = undefined;
      this.setState(this.pending === undefined ? "saved" : "dirty");
    } catch (error) {
      // Keep pending content so the caller can retry or copy it elsewhere.
      this.setState("failed", error);
    }
  }
}
