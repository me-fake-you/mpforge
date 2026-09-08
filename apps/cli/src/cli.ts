import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { accessSync } from "node:fs";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { sha256 } from "@mpforge/audit";
import {
  articlePaths,
  isArticleStatus,
  parseArticleDocument,
  parseStateEvents,
  serializeArticleDocument,
  validateStateEventChain,
  validateFrontmatter,
  type ArticleFrontmatter,
  type FrontmatterValue,
} from "@mpforge/content-schema";
import {
  ContentStoreError,
  createArticle as createStoredArticle,
  listArticles as listStoredArticles,
  openArticle as openStoredArticle,
  saveArticle as saveStoredArticle,
  transitionArticle as transitionStoredArticle,
} from "@mpforge/content-store";
import {
  canCreateDraft,
  applySafeFixesTransactional,
  formatGitHubAnnotations,
  formatLintHtml,
  formatLintText,
  lintArticle,
  serializeLintReport,
  serializeLintSarif,
  type AssetInventoryItem,
  type LintReport,
} from "@mpforge/linter";
import {
  hashAssetManifest,
  importLocalAsset,
  importRemoteAsset,
  optimizeArticleAssets,
  readAssetManifest,
  scanArticleAssets,
  updateAssetRights,
  verifyAssetRights,
  writeAssetManifest,
  type AssetManifest,
} from "@mpforge/media";
import { generateArticlePreviews, type PreviewReport } from "@mpforge/preview";
import {
  EMPTY_REVIEW_CHECKLIST,
  REVIEW_CHECKLIST_KEYS,
  prepareReview,
  type ApprovalRequest,
  type ReviewChecklist,
  type ReviewEvidence,
} from "@mpforge/review-gate";
import {
  approveReview,
  invalidateApprovalIfNeeded,
  readApprovalRecords,
  readInvalidationRecords,
  revokeApproval as revokeStoredApproval,
  type StatusTransaction,
} from "@mpforge/review-gate/node";
import {
  renderArticle as renderHeadlessArticle,
  type RenderResult as HeadlessRenderResult,
} from "@mpforge/renderer";
import { originalThemes } from "@mpforge/themes";
import { MockProvider, RealDraftProvider } from "@mpforge/wechat-adapter";

export const ORIGINAL_THEMES = [
  "minimal",
  "academic-blue",
  "warm-editorial",
  "tech-dark-accent",
] as const;

if (
  ORIGINAL_THEMES.join("\0") !==
  originalThemes.map((theme) => theme.id).join("\0")
) {
  throw new Error("ORIGINAL_THEME_REGISTRY_MISMATCH");
}

export interface ArticleContext {
  root: string;
  slug: string;
  articlePath: string;
  articleDirectory: string;
  source: string;
  document: ReturnType<typeof parseArticleDocument>;
  frontmatter: Record<string, FrontmatterValue | undefined>;
  body: string;
  frontmatterValidation: ReturnType<typeof validateFrontmatter>;
  assets: AssetInventoryItem[];
  contentHash: string;
  approvalRecordExists: boolean;
}

export type RenderResult = HeadlessRenderResult;

export class CliError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CliError";
  }
}

export function findWorkspaceRoot(start = process.cwd()): string {
  const configured = process.env.MPFORGE_ROOT;
  if (configured) return path.resolve(configured);
  let current = path.resolve(start);
  while (true) {
    try {
      accessSync(path.join(current, ".project-root.json"));
      return current;
    } catch {
      try {
        accessSync(path.join(current, "pnpm-workspace.yaml"));
        accessSync(path.join(current, "package.json"));
        return current;
      } catch {
        const parent = path.dirname(current);
        if (parent === current) return path.resolve(start);
        current = parent;
      }
    }
  }
}

function safeRootPath(root: string, candidate: string): string {
  const absolute = path.resolve(root, candidate);
  const relative = path.relative(root, absolute);
  if (
    relative === ".." ||
    relative.startsWith(".." + path.sep) ||
    path.isAbsolute(relative)
  ) {
    throw new CliError(
      "PATH_OUTSIDE_WORKSPACE",
      "Article path must remain inside the MPForge workspace.",
    );
  }
  return absolute;
}

async function isFile(candidate: string): Promise<boolean> {
  try {
    return (await stat(candidate)).isFile();
  } catch {
    return false;
  }
}

export function resolveArticlePath(
  root: string,
  input: string,
): { slug: string; articlePath: string } {
  const value = input.trim();
  if (!value)
    throw new CliError(
      "ARTICLE_REQUIRED",
      "An article slug or article.md path is required.",
    );
  const normalized = value.replace(/\\/g, "/");
  if (normalized.endsWith("/article.md") || normalized === "article.md") {
    const absolute = safeRootPath(root, normalized);
    const relative = path.relative(root, absolute).replace(/\\/g, "/");
    const match = /^content\/([^/]+)\/article\.md$/.exec(relative);
    if (!match)
      throw new CliError(
        "ARTICLE_PATH_INVALID",
        "Article files must be content/<slug>/article.md.",
      );
    return { slug: match[1], articlePath: absolute };
  }
  const slug = normalized.startsWith("content/")
    ? normalized.slice("content/".length).replace(/\/.*$/, "")
    : normalized;
  const paths = articlePaths(slug);
  return { slug: paths.slug, articlePath: safeRootPath(root, paths.article) };
}

async function assetInventory(
  articleDirectory: string,
  body: string,
): Promise<AssetInventoryItem[]> {
  const references = new Set<string>();
  const imagePattern = /!\[[^\]]*\]\(([^\s)]+)(?:\s+["'][^"']*["'])?\)/g;
  for (const match of body.matchAll(imagePattern)) {
    if (match[1] && !/^https?:\/\//i.test(match[1])) references.add(match[1]);
  }
  const items: AssetInventoryItem[] = [];
  for (const reference of references) {
    const candidate = path.resolve(
      articleDirectory,
      reference.replace(/\\/g, path.sep),
    );
    const relative = path.relative(articleDirectory, candidate);
    if (relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
      items.push({ reference, exists: false });
      continue;
    }
    try {
      const info = await stat(candidate);
      if (!info.isFile()) {
        items.push({ reference, exists: false });
        continue;
      }
      const bytes = await readFile(candidate);
      items.push({
        reference,
        exists: true,
        sizeBytes: info.size,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    } catch {
      items.push({ reference, exists: false });
    }
  }
  return items;
}

async function round2AssetInventory(
  articleDirectory: string,
  body: string,
  coverReference?: string,
): Promise<AssetInventoryItem[]> {
  const discovered = await assetInventory(
    articleDirectory,
    coverReference ? `${body}\n\n![cover](${coverReference})\n` : body,
  );
  const manifest = await readAssetManifest(articleDirectory);
  const byReference = new Map(
    manifest.assets.flatMap((asset) => [
      [asset.original_reference, asset] as const,
      [asset.normalized_path, asset] as const,
      [asset.local_path, asset] as const,
    ]),
  );
  const enriched = discovered.map((item) => {
    const registered = byReference.get(item.reference);
    return registered
      ? {
          ...item,
          sha256: registered.sha256,
          localPath: registered.local_path,
          sourceType: registered.source_type,
          sourceUrl: registered.source_url,
          rightsStatus: registered.rights_status,
          license: registered.license,
          attribution: registered.attribution,
          mimeType: registered.mime_type,
          width: registered.width,
          height: registered.height,
          unsafeSvg: registered.warnings.some((warning) =>
            warning.startsWith("SVG_"),
          ),
        }
      : item;
  });
  const represented = new Set(enriched.map((item) => item.sha256));
  for (const asset of manifest.assets) {
    if (represented.has(asset.sha256)) continue;
    enriched.push({
      reference: asset.original_reference,
      exists: true,
      sizeBytes: asset.file_size,
      width: asset.width,
      height: asset.height,
      sha256: asset.sha256,
      localPath: asset.local_path,
      sourceType: asset.source_type,
      sourceUrl: asset.source_url,
      rightsStatus: asset.rights_status,
      license: asset.license,
      attribution: asset.attribution,
      mimeType: asset.mime_type,
      unsafeSvg: asset.warnings.some((warning) => warning.startsWith("SVG_")),
    });
  }
  return enriched.sort((left, right) =>
    left.reference.localeCompare(right.reference),
  );
}

/**
 * Hash author-controlled article content while excluding lifecycle bookkeeping
 * that necessarily changes during the reviewed -> approved transaction.
 */
export function approvalSourceHash(source: string): string {
  const canonical = source.replace(
    /^(status|human_reviewed|updated_at|version):[^\r\n]*$/gm,
    "$1: <workflow-managed>",
  );
  return sha256(canonical);
}

export async function readArticle(
  input: string,
  root = findWorkspaceRoot(),
): Promise<ArticleContext> {
  const resolved = resolveArticlePath(root, input);
  let stored;
  try {
    stored = await openStoredArticle(root, resolved.slug);
  } catch (error) {
    if (error instanceof ContentStoreError) {
      throw new CliError(error.code, error.message);
    }
    throw error;
  }
  const source = stored.raw;
  const document = {
    ...parseArticleDocument(source),
    frontmatter: stored.frontmatter,
  };
  const frontmatter = stored.frontmatter;
  return {
    root,
    slug: resolved.slug,
    articlePath: resolved.articlePath,
    articleDirectory: path.dirname(resolved.articlePath),
    source,
    document,
    frontmatter,
    body: document.body,
    frontmatterValidation: validateFrontmatter(frontmatter),
    assets: await round2AssetInventory(
      path.dirname(resolved.articlePath),
      document.body,
      typeof frontmatter.cover === "string" ? frontmatter.cover : undefined,
    ),
    contentHash: stored.contentHash,
    approvalRecordExists: await isFile(
      path.join(
        path.dirname(resolved.articlePath),
        "history",
        "approvals.jsonl",
      ),
    ),
  };
}

export function makeLintReport(
  article: ArticleContext,
  renderedHtml?: string,
  renderedCss?: string,
  determinism?: { firstHtmlHash: string; secondHtmlHash: string },
  safeHtml?: string,
  wechatHtml?: string,
  renderedHtmlHash?: string,
): LintReport {
  return lintArticle({
    articlePath: path
      .relative(article.root, article.articlePath)
      .replace(/\\/g, "/"),
    frontmatter: article.frontmatter,
    markdown: article.body,
    renderedHtml,
    renderedCss,
    safeHtml,
    wechatHtml,
    assets: article.assets,
    determinism,
    articleSlug: article.slug,
    articleId:
      typeof article.frontmatter.id === "string"
        ? article.frontmatter.id
        : undefined,
    sourceHash: approvalSourceHash(article.source),
    renderedHtmlHash:
      renderedHtmlHash ?? (renderedHtml ? sha256(renderedHtml) : undefined),
    generatedAt:
      typeof article.frontmatter.updated_at === "string"
        ? article.frontmatter.updated_at
        : "1970-01-01T00:00:00.000Z",
    approvalRecordExists: article.approvalRecordExists,
  });
}

export async function writeLintReport(
  article: ArticleContext,
  report: LintReport,
): Promise<void> {
  await mkdir(path.join(article.articleDirectory, "build"), {
    recursive: true,
  });
  await writeFile(
    path.join(article.articleDirectory, "build", "lint-report.json"),
    serializeLintReport(report),
    "utf8",
  );
  await writeFile(
    path.join(article.articleDirectory, "build", "lint-report.html"),
    formatLintHtml(report),
    "utf8",
  );
  await writeFile(
    path.join(article.articleDirectory, "build", "lint-report.sarif"),
    serializeLintSarif(report),
    "utf8",
  );
}

export async function renderArticle(
  article: ArticleContext,
  mode: "light" | "dark" = "light",
): Promise<RenderResult> {
  return renderHeadlessArticle({
    markdown: article.body,
    themeId: String(article.frontmatter.theme ?? "minimal"),
    colorScheme: mode,
  });
}

async function persistRendered(
  article: ArticleContext,
  result: RenderResult,
  mode: "light" | "dark",
): Promise<void> {
  await mkdir(path.join(article.articleDirectory, "build"), {
    recursive: true,
  });
  const file = mode === "light" ? "article.html" : "article.dark.html";
  await writeFile(
    path.join(article.articleDirectory, "build", file),
    result.documentHtml ?? result.html,
    "utf8",
  );
  if (mode === "light") {
    await Promise.all([
      writeFile(
        path.join(article.articleDirectory, "build", "article.raw.html"),
        result.rawDocumentHtml,
        "utf8",
      ),
      writeFile(
        path.join(article.articleDirectory, "build", "article.safe.html"),
        result.safeDocumentHtml,
        "utf8",
      ),
      writeFile(
        path.join(article.articleDirectory, "build", "article.wechat.html"),
        result.wechatDocumentHtml,
        "utf8",
      ),
      writeFile(
        path.join(article.articleDirectory, "build", "article.meta.json"),
        `${JSON.stringify(
          {
            schema: "mpforge.build/v2",
            article_id: String(article.frontmatter.id ?? ""),
            source_hash: approvalSourceHash(article.source),
            rendered_html_hash: result.renderedHtmlHash,
            wechat_html_hash: result.wechatHtmlHash,
            theme_id: result.themeId,
            theme_version: result.themeVersion,
            theme_hash: result.themeHash,
            renderer_version: result.rendererVersion,
            build_settings_hash: sha256("mpforge-build/v2:raw,safe,wechat"),
            generated_at:
              typeof article.frontmatter.updated_at === "string"
                ? article.frontmatter.updated_at
                : "1970-01-01T00:00:00.000Z",
          },
          null,
          2,
        )}\n`,
        "utf8",
      ),
    ]);
  }
}

function statusOf(article: ArticleContext): ArticleFrontmatter["status"] {
  const value = article.frontmatter.status;
  if (typeof value !== "string")
    throw new CliError(
      "STATUS_INVALID",
      "Article status is missing or invalid.",
    );
  return value as ArticleFrontmatter["status"];
}

function reviewStatusTransaction(
  article: ArticleContext,
  actor: { actorType: "human" | "automation"; actorId: string },
  reason: string,
  sourceCommit: string,
): StatusTransaction {
  const change = async (status: ArticleFrontmatter["status"]) => {
    const current = await readArticle(article.slug, article.root);
    if (statusOf(current) === status) return;
    await transitionStoredArticle(article.root, article.slug, status, {
      actorType: actor.actorType,
      actorId: actor.actorId,
      reason,
      sourceCommit,
      ...(status === "approved" ? { explicitHumanAction: true } : {}),
    });
  };
  return { writeStatus: change, restoreStatus: change };
}

export async function showArticle(
  input: string,
  root = findWorkspaceRoot(),
): Promise<{
  slug: string;
  path: string;
  frontmatter: ArticleContext["frontmatter"];
  body: string;
}> {
  const article = await readArticle(input, root);
  return {
    slug: article.slug,
    path: path.relative(root, article.articlePath).replace(/\\/g, "/"),
    frontmatter: article.frontmatter,
    body: article.body,
  };
}

export async function validateArticle(
  input: string,
  root = findWorkspaceRoot(),
) {
  const article = await readArticle(input, root);
  return {
    slug: article.slug,
    path: path.relative(root, article.articlePath).replace(/\\/g, "/"),
    ...article.frontmatterValidation,
  };
}

export async function transitionArticle(
  input: string,
  target: string,
  options: { actorId?: string; reason?: string } = {},
  root = findWorkspaceRoot(),
): Promise<ArticleContext> {
  const article = await readArticle(input, root);
  const current = statusOf(article);
  if (!isArticleStatus(target)) {
    throw new CliError(
      "STATUS_INVALID",
      `Unsupported article status: ${target || "(empty)"}.`,
    );
  }
  if (target === "approved") {
    throw new CliError(
      "HUMAN_APPROVAL_CONFIRMATION_REQUIRED",
      "Use `mpforge approve <slug> --confirm-human-review --actor <reviewer>` for the explicit human approval action.",
    );
  }
  try {
    await transitionStoredArticle(root, article.slug, target, {
      actorType: "automation",
      actorId: options.actorId?.trim() || "mpforge-cli",
      reason: options.reason || "Status transition from the MPForge CLI",
      sourceCommit: await gitCommit(root),
    });
    return readArticle(input, root);
  } catch (error) {
    if (error instanceof ContentStoreError) {
      throw new CliError(
        error.code,
        `Cannot transition ${article.slug} from ${current} to ${target}: ${error.message}`,
      );
    }
    throw error;
  }
}

export async function lintCommand(
  input: string,
  options: { fixSafe?: boolean } = {},
  root = findWorkspaceRoot(),
): Promise<LintReport> {
  let article = await readArticle(input, root);
  if (options.fixSafe) {
    const backup = path.join(
      article.articleDirectory,
      "history",
      "backups",
      `safe-fix-${Date.now()}-${article.contentHash.slice(0, 12)}.md`,
    );
    let updatedSource = article.source;
    await applySafeFixesTransactional({
      markdown: article.body,
      createBackup: async () => {
        await mkdir(path.dirname(backup), { recursive: true });
        await copyFile(article.articlePath, backup);
      },
      write: async (body) => {
        updatedSource = serializeArticleDocument({
          ...article.document,
          body,
        });
        await saveStoredArticle(root, article.slug, {
          raw: updatedSource,
          expectedHash: article.contentHash,
        });
      },
      validate: async () => {
        const checked = await readArticle(article.slug, root);
        return checked.frontmatterValidation.valid;
      },
      rollback: async () => {
        const current = await openStoredArticle(root, article.slug);
        await saveStoredArticle(root, article.slug, {
          raw: article.source,
          expectedHash: current.contentHash,
        });
      },
    });
    article = await readArticle(input, root);
  }
  return (await buildArticleArtifacts(article)).report;
}

export interface ArticleBuildResult {
  article: ArticleContext;
  light: RenderResult;
  dark: RenderResult;
  report: LintReport;
}

export async function buildArticleArtifacts(
  articleOrInput: ArticleContext | string,
  root = findWorkspaceRoot(),
): Promise<ArticleBuildResult> {
  const article =
    typeof articleOrInput === "string"
      ? await readArticle(articleOrInput, root)
      : articleOrInput;
  const light = await renderArticle(article, "light");
  const dark = await renderArticle(article, "dark");
  const repeated = await renderArticle(article, "light");
  await persistRendered(article, light, "light");
  await persistRendered(article, dark, "dark");
  const report = makeLintReport(
    article,
    light.rawHtml,
    light.css,
    {
      firstHtmlHash: light.renderedHtmlHash,
      secondHtmlHash: repeated.renderedHtmlHash,
    },
    light.safeHtml,
    light.wechatHtml,
    light.renderedHtmlHash,
  );
  await writeLintReport(article, report);
  return { article, light, dark, report };
}

export async function previewArticle(
  input: string,
  root = findWorkspaceRoot(),
): Promise<PreviewReport> {
  const built = await buildArticleArtifacts(input, root);
  return generateArticlePreviews({
    articleId: String(built.article.frontmatter.id ?? built.article.slug),
    stages: {
      raw: built.light.rawDocumentHtml,
      safe: built.light.safeDocumentHtml,
      wechat: built.light.wechatDocumentHtml,
    },
    darkStages: {
      raw: built.dark.rawDocumentHtml,
      safe: built.dark.safeDocumentHtml,
      wechat: built.dark.wechatDocumentHtml,
    },
    sourceHash: approvalSourceHash(built.article.source),
    renderedHtmlHash: built.light.renderedHtmlHash,
    outputDirectory: path.join(built.article.articleDirectory, "build"),
    baseUrl: new URL(
      `file:///${built.article.articleDirectory.replace(/\\/g, "/")}/`,
    ).href,
    includeSafeStage: true,
    generatedAt:
      typeof built.article.frontmatter.updated_at === "string"
        ? built.article.frontmatter.updated_at
        : undefined,
  });
}

export async function assetsScan(input: string, root = findWorkspaceRoot()) {
  const article = await readArticle(input, root);
  return scanArticleAssets(article.articleDirectory, { createManifest: true });
}

export async function assetsList(input: string, root = findWorkspaceRoot()) {
  const article = await readArticle(input, root);
  return readAssetManifest(article.articleDirectory);
}

export async function assetsImport(
  input: string,
  source: string,
  options: {
    importedBy: string;
    userOwned?: boolean;
    generatedBy?: string;
    rightsAcknowledged?: boolean;
  },
  root = findWorkspaceRoot(),
) {
  const article = await readArticle(input, root);
  if (/^https?:\/\//i.test(source)) {
    if (options.rightsAcknowledged !== true)
      throw new CliError(
        "RIGHTS_ACKNOWLEDGEMENT_REQUIRED",
        "Remote import requires --acknowledge-rights; it remains pending until a human approves the rights record.",
      );
    return importRemoteAsset(article.articleDirectory, source, {
      importedBy: options.importedBy,
      rightsAcknowledged: true,
    });
  }
  return importLocalAsset(article.articleDirectory, source, {
    importedBy: options.importedBy,
    sourceType: options.userOwned
      ? "user_owned"
      : options.generatedBy
        ? "generated"
        : "local",
    ...(options.userOwned ? { userOwnedConfirmed: true } : {}),
    ...(options.generatedBy ? { generationMethod: options.generatedBy } : {}),
    rightsStatus: "pending",
  });
}

export async function assetsOptimize(
  input: string,
  root = findWorkspaceRoot(),
) {
  const article = await readArticle(input, root);
  return optimizeArticleAssets(article.articleDirectory);
}

export async function assetsVerify(input: string, root = findWorkspaceRoot()) {
  const article = await readArticle(input, root);
  const manifest = await readAssetManifest(article.articleDirectory);
  return verifyAssetRights(manifest);
}

async function filePresent(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

async function fileHash(file: string): Promise<string> {
  try {
    return sha256(await readFile(file));
  } catch {
    return "";
  }
}

export async function collectReviewEvidence(
  input: string,
  root = findWorkspaceRoot(),
): Promise<ReviewEvidence> {
  const article = await readArticle(input, root);
  const build = path.join(article.articleDirectory, "build");
  const metaFile = path.join(build, "article.meta.json");
  const lintFile = path.join(build, "lint-report.json");
  const previewFile = path.join(build, "preview-report.json");
  const manifestFile = path.join(
    article.articleDirectory,
    "assets",
    "manifest.json",
  );
  const meta = (await readJson<Record<string, unknown>>(metaFile)) ?? {};
  const lint = await readJson<LintReport>(lintFile);
  const preview = await readJson<PreviewReport>(previewFile);
  const manifest = await readAssetManifest(article.articleDirectory);
  const value = (key: string) =>
    typeof meta[key] === "string" ? String(meta[key]) : "";
  const sourceHash = approvalSourceHash(article.source);
  const publishSettingsHash = sha256(
    JSON.stringify({
      account: article.frontmatter.account ?? null,
      cover: article.frontmatter.cover ?? null,
      original: article.frontmatter.original ?? null,
    }),
  );
  const currentStatus = statusOf(article);
  const reviewStatus = [
    "idea",
    "draft",
    "reviewing",
    "reviewed",
    "approved",
  ].includes(currentStatus)
    ? (currentStatus as ReviewEvidence["status"])
    : "draft";
  return {
    articleId: String(article.frontmatter.id ?? article.slug),
    status: reviewStatus,
    sourceHash,
    renderedHtmlHash: value("rendered_html_hash"),
    wechatHtmlHash: value("wechat_html_hash"),
    lintReportHash: await fileHash(lintFile),
    assetsManifestHash: await fileHash(manifestFile),
    themeHash: value("theme_hash"),
    rendererVersion: value("renderer_version"),
    linterVersion: lint?.linter_version ?? "",
    rulesetVersion: lint?.ruleset_version ?? "",
    buildSettingsHash: value("build_settings_hash"),
    publishSettingsHash,
    lintErrorCount: lint?.error_count ?? Number.POSITIVE_INFINITY,
    assets: manifest.assets.map((asset) => ({
      assetId: asset.asset_id,
      rightsStatus: asset.rights_status,
    })),
    artifacts: {
      rawHtml: await filePresent(path.join(build, "article.raw.html")),
      safeHtml: await filePresent(path.join(build, "article.safe.html")),
      wechatHtml: await filePresent(path.join(build, "article.wechat.html")),
      lintReport: Boolean(lint),
      assetsManifest: await filePresent(manifestFile),
      previewReport: Boolean(preview),
    },
    buildSourceHash: value("source_hash"),
    lintSourceHash: lint?.source_hash ?? "",
    lintRenderedHtmlHash: lint?.rendered_html_hash ?? "",
    previewSourceHash: preview?.source_hash ?? "",
    previewRenderedHtmlHash: preview?.rendered_html_hash ?? "",
    previewWechatHtmlHash: preview?.stage_hashes.wechat ?? "",
  };
}

export async function prepareArticleReview(
  input: string,
  root = findWorkspaceRoot(),
) {
  const evidence = await collectReviewEvidence(input, root);
  const article = await readArticle(input, root);
  const approvals = await readApprovalRecords(
    path.join(article.articleDirectory, "history"),
  );
  const invalidations = await readInvalidationRecords(
    path.join(article.articleDirectory, "history"),
  );
  return {
    evidence,
    eligibility: prepareReview(evidence),
    approvals,
    invalidations,
    checklist: { ...EMPTY_REVIEW_CHECKLIST },
  };
}

export async function requestHumanReview(
  input: string,
  root = findWorkspaceRoot(),
): Promise<ArticleContext> {
  return transitionArticle(
    input,
    "reviewing",
    { actorId: "mpforge-review-gate", reason: "Human review requested" },
    root,
  );
}

export async function markArticleReviewed(
  input: string,
  root = findWorkspaceRoot(),
): Promise<ArticleContext> {
  const prepared = await prepareArticleReview(input, root);
  if (!prepared.eligibility.eligible)
    throw new CliError(
      "REVIEW_EVIDENCE_BLOCKED",
      prepared.eligibility.blockers.map((item) => item.message).join("; "),
    );
  return transitionArticle(
    input,
    "reviewed",
    { actorId: "mpforge-review-gate", reason: "Review evidence completed" },
    root,
  );
}

function interactiveApprovalAvailable(): boolean {
  return Boolean(
    process.stdin.isTTY &&
      process.stdout.isTTY &&
      process.env.CI !== "true" &&
      process.env.GITHUB_ACTIONS !== "true" &&
      !["agent", "skill", "mcp", "ci", "automation", "github_action"].includes(
        (process.env.MPFORGE_ACTOR_TYPE ?? "human").toLocaleLowerCase(),
      ),
  );
}

async function promptHumanApproval(
  request: Omit<ApprovalRequest, "checklist" | "actor" | "confirmedSourceHash">,
  warnings: readonly string[],
  manifest: AssetManifest,
): Promise<ApprovalRequest> {
  if (!interactiveApprovalAvailable())
    throw new CliError(
      "INTERACTIVE_HUMAN_REQUIRED",
      "Approval is available only in an interactive human terminal; Agent, Skill, MCP, CI, GitHub Action, redirected input, and --yes flows are blocked.",
    );
  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    console.log(`Current source_hash: ${request.evidence.sourceHash}`);
    console.log(
      warnings.length
        ? `Warnings (${warnings.length}):\n${warnings.map((item) => `- ${item}`).join("\n")}`
        : "Warnings: none",
    );
    console.log("Asset rights:");
    for (const asset of manifest.assets)
      console.log(
        `- ${asset.asset_id}: ${asset.rights_status} (${asset.original_reference})`,
      );
    const reviewerId = (await terminal.question("Human reviewer id: ")).trim();
    const confirmedSourceHash = (
      await terminal.question("Retype the complete source_hash: ")
    ).trim();
    const checklist = { ...EMPTY_REVIEW_CHECKLIST } as ReviewChecklist;
    for (const key of REVIEW_CHECKLIST_KEYS) {
      const answer = (
        await terminal.question(`Confirm ${key}? Type YES: `)
      ).trim();
      checklist[key] = answer === "YES";
    }
    const warningConfirmation = warnings.length
      ? (
          await terminal.question(
            "Type ACK WARNINGS to acknowledge all warnings: ",
          )
        ).trim()
      : "ACK WARNINGS";
    const final = (
      await terminal.question(
        "Type APPROVE to create the bound approval record: ",
      )
    ).trim();
    if (warningConfirmation !== "ACK WARNINGS" || final !== "APPROVE")
      throw new CliError(
        "APPROVAL_CANCELLED",
        "Human approval was not explicitly confirmed.",
      );
    return {
      ...request,
      checklist,
      actor: {
        actorType: "human",
        actorId: reviewerId,
        explicitHumanAction: true,
      },
      confirmedSourceHash,
      warningsAcknowledged: [...warnings],
    };
  } finally {
    terminal.close();
  }
}

/** There is deliberately no options/--yes programmatic approval surface. */
export async function approveArticle(
  input: string,
  rootOrLegacyOptions:
    | string
    | { confirmedHumanReview: boolean; actorId: string } = findWorkspaceRoot(),
  legacyRoot?: string,
) {
  const root =
    typeof rootOrLegacyOptions === "string"
      ? rootOrLegacyOptions
      : (legacyRoot ?? findWorkspaceRoot());
  if (typeof rootOrLegacyOptions !== "string")
    throw new CliError(
      "APPROVAL_BYPASS_BLOCKED",
      "Legacy confirmation flags cannot approve. Run `mpforge approve <slug>` in a human terminal and complete every prompt.",
    );
  const article = await readArticle(input, root);
  const prepared = await prepareArticleReview(input, root);
  const lint = await readJson<LintReport>(
    path.join(article.articleDirectory, "build", "lint-report.json"),
  );
  const manifest = await readAssetManifest(article.articleDirectory);
  const sourceCommit = await gitCommit(root);
  const request = await promptHumanApproval(
    {
      evidence: prepared.evidence,
      warningsAcknowledged: [],
      sourceCommit,
    },
    (lint?.diagnostics ?? [])
      .filter((item) => item.severity === "WARNING")
      .map((item) => `${item.rule_id}: ${item.message}`),
    manifest,
  );
  try {
    const approval = await approveReview({
      historyDirectory: path.join(article.articleDirectory, "history"),
      request,
      statusTransaction: reviewStatusTransaction(
        article,
        { actorType: "human", actorId: request.actor.actorId },
        "Bound quality-gate approval",
        sourceCommit,
      ),
    });
    return { article: await readArticle(input, root), approval };
  } catch (error) {
    throw new CliError(
      "APPROVAL_BLOCKED",
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function revokeArticleApproval(
  input: string,
  root = findWorkspaceRoot(),
) {
  if (!interactiveApprovalAvailable())
    throw new CliError(
      "INTERACTIVE_HUMAN_REQUIRED",
      "Revoking approval requires an interactive human terminal.",
    );
  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  let reviewerId = "";
  try {
    reviewerId = (await terminal.question("Human reviewer id: ")).trim();
    if ((await terminal.question("Type REVOKE: ")).trim() !== "REVOKE")
      throw new CliError(
        "REVOCATION_CANCELLED",
        "Approval revocation cancelled.",
      );
  } finally {
    terminal.close();
  }
  const article = await readArticle(input, root);
  const evidence = await collectReviewEvidence(input, root);
  const sourceCommit = await gitCommit(root);
  return revokeStoredApproval({
    historyDirectory: path.join(article.articleDirectory, "history"),
    current: evidence,
    actor: {
      actorType: "human",
      actorId: reviewerId,
      explicitHumanAction: true,
    },
    statusTransaction: reviewStatusTransaction(
      article,
      { actorType: "human", actorId: reviewerId },
      "Human revoked approval",
      sourceCommit,
    ),
  });
}

export async function preflightArticle(
  input: string,
  root = findWorkspaceRoot(),
) {
  await assetsScan(input, root);
  const build = await buildArticleArtifacts(input, root);
  const preview = await previewArticle(input, root);
  let evidence = await collectReviewEvidence(input, root);
  let invalidation = null;
  if (evidence.status === "approved") {
    invalidation = await invalidateApprovalIfNeeded({
      historyDirectory: path.join(build.article.articleDirectory, "history"),
      current: evidence,
      actor: { actorType: "automation", actorId: "mpforge-preflight" },
      statusTransaction: reviewStatusTransaction(
        build.article,
        { actorType: "automation", actorId: "mpforge-preflight" },
        "Approval invalidated because bound evidence changed",
        await gitCommit(root),
      ),
    });
    if (invalidation) evidence = await collectReviewEvidence(input, root);
  }
  return {
    lint: build.report,
    preview,
    assets: await assetsVerify(input, root),
    review: prepareReview(evidence),
    invalidation,
  };
}

export async function createArticle(
  slug: string,
  root = findWorkspaceRoot(),
): Promise<ArticleContext> {
  try {
    const stored = await createStoredArticle(root, {
      slug,
      title: slug,
      body: "# " + slug + "\n\nStart drafting here.\n",
    });
    return readArticle(stored.slug, root);
  } catch (error) {
    if (error instanceof ContentStoreError) {
      throw new CliError(error.code, error.message);
    }
    throw error;
  }
}

export async function initializeWorkspace(
  root = findWorkspaceRoot(),
): Promise<void> {
  await mkdir(root, { recursive: true });
  try {
    await writeFile(
      path.join(root, ".project-root.json"),
      `${JSON.stringify(
        {
          project_name: "MPForge",
          project_slug: "mpforge",
          absolute_path: path.resolve(root),
          uuid: randomUUID(),
          created_at: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      { encoding: "utf8", flag: "wx" },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  for (const directory of ["content", "examples", "reports", "artifacts"])
    await mkdir(path.join(root, directory), { recursive: true });
}

export async function auditArticle(input: string, root = findWorkspaceRoot()) {
  const article = await readArticle(input, root);
  let raw = "";
  try {
    raw = await readFile(
      path.join(article.articleDirectory, "history", "state-events.jsonl"),
      "utf8",
    );
  } catch {
    // Empty audit.
  }
  const parsed = parseStateEvents(raw);
  const chain = validateStateEventChain(parsed.events);
  return {
    events: parsed.events,
    status: chain.status,
    currentStatus: article.frontmatter.status,
    valid:
      parsed.errors.length === 0 &&
      chain.valid &&
      chain.status === article.frontmatter.status,
    errors: [
      ...parsed.errors,
      ...chain.errors,
      ...(chain.status !== article.frontmatter.status
        ? [
            `History ends at ${chain.status}, article is ${String(article.frontmatter.status)}`,
          ]
        : []),
    ],
  };
}

function gitCommit(root: string): Promise<string> {
  return new Promise((resolve) =>
    execFile(
      "git",
      ["-C", root, "rev-parse", "HEAD"],
      { windowsHide: true },
      (error, stdout) =>
        resolve(error ? "uncommitted" : stdout.trim() || "uncommitted"),
    ),
  );
}

function mimeType(file: string): string {
  const extension = path.extname(file).toLowerCase();
  return (
    {
      ".avif": "image/avif",
      ".gif": "image/gif",
      ".jpeg": "image/jpeg",
      ".jpg": "image/jpeg",
      ".png": "image/png",
      ".svg": "image/svg+xml",
      ".webp": "image/webp",
    }[extension] ?? "application/octet-stream"
  );
}

export async function draftArticle(
  _input: string,
  _options: { mock?: boolean; accountAlias?: string; confirm?: boolean },
  _root = findWorkspaceRoot(),
): Promise<never> {
  throw new CliError(
    "TWO_PHASE_DRAFT_REQUIRED",
    "Direct draft creation was removed. Prepare an immutable operation, then execute that operation through the Round 3 safety gate.",
  );
}

export async function listArticles(
  root = findWorkspaceRoot(),
): Promise<
  Array<{ slug: string; path: string; status?: unknown; title?: unknown }>
> {
  return (await listStoredArticles(root)).map((article) => ({
    slug: article.slug,
    path: path.relative(root, article.path).replace(/\\/g, "/"),
    status: article.frontmatter.status,
    title: article.frontmatter.title,
  }));
}

export async function getReceipt(
  input: string,
  root = findWorkspaceRoot(),
): Promise<Record<string, unknown> | null> {
  const article = await readArticle(input, root);
  try {
    const names = (
      await readdir(path.join(article.articleDirectory, "receipts"))
    )
      .filter((name) => name.endsWith(".json"))
      .sort();
    if (!names.length) return null;
    return JSON.parse(
      await readFile(
        path.join(
          article.articleDirectory,
          "receipts",
          names[names.length - 1],
        ),
        "utf8",
      ),
    ) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function doctor(root = findWorkspaceRoot()) {
  let hasContentDirectory = false;
  try {
    hasContentDirectory = (
      await stat(path.join(root, "content"))
    ).isDirectory();
  } catch {
    hasContentDirectory = false;
  }
  let writable = false;
  try {
    accessSync(root, 2);
    writable = true;
  } catch {
    writable = false;
  }
  const configuredBrowser = process.env.MPFORGE_CHROMIUM_EXECUTABLE;
  const browser = configuredBrowser ? await isFile(configuredBrowser) : false;
  const pnpm =
    process.env.npm_config_user_agent?.startsWith("pnpm/") === true ||
    process.env.npm_execpath?.toLowerCase().includes("pnpm") === true;
  const workspace =
    (await isFile(path.join(root, "package.json"))) &&
    (await isFile(path.join(root, "pnpm-workspace.yaml")));
  const checks = {
    workspace,
    projectDirectory: path.isAbsolute(root),
    writable,
    contentDirectory: hasContentDirectory,
    node: Number(process.versions.node.split(".")[0]) >= 22,
    pnpm,
    browser,
    renderer: typeof renderHeadlessArticle === "function",
    mockServer: typeof MockProvider === "function",
    realAdapterContract: typeof RealDraftProvider === "function",
    configFile: await isFile(path.join(root, ".project-root.json")),
    credentialsInspected: false,
    networkModeMockOnly: process.env.MPFORGE_NETWORK_MODE === "mock-only",
    realWechatDisabled: process.env.MPFORGE_REAL_WECHAT_DISABLED !== "false",
  };
  return {
    ok:
      checks.workspace &&
      checks.projectDirectory &&
      checks.writable &&
      checks.node &&
      checks.pnpm &&
      checks.mockServer &&
      checks.realWechatDisabled,
    checks,
    notes: [
      "Credentials are never inspected or printed by doctor.",
      checks.contentDirectory
        ? "Content workspace is present."
        : "No content directory yet; run `pnpm mpforge init` when you want a local workspace.",
      checks.browser
        ? "A project-local Chromium executable is configured."
        : "Browser preview is optional and not configured; install Chromium inside this project before preview capture.",
      checks.configFile
        ? "Private development marker detected; it is excluded from the public source export."
        : "Portable public-source mode detected.",
    ],
  };
}
