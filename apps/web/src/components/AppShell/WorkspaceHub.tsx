import {
  AlertTriangle,
  Clock3,
  FileCode2,
  FilePlus2,
  FolderOpen,
  GitCommitHorizontal,
  Image as ImageIcon,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { ArticleStatus } from "@mpforge/content-schema";
import {
  EMPTY_REVIEW_CHECKLIST,
  REVIEW_CHECKLIST_KEYS,
  type ReviewChecklist,
} from "@mpforge/review-gate";
import type { FileItem } from "../../store/fileTypes";
import { useAppViewStore, type AppView } from "../../store/appViewStore";
import {
  buildWorkbenchEvidence,
  type WorkbenchEvidence,
} from "../../services/mpforgeWorkbench";
import { Round3DraftWorkspace } from "./Round3DraftWorkspace";
import { isPublicDemoMode } from "../../demo/demoMode";
import "./WorkspaceHub.css";

interface WorkspaceHubProps {
  view: Exclude<AppView, "editor">;
  articles: FileItem[];
  currentFile: FileItem | null;
  workspacePath: string | null;
  onCreateArticle: () => void;
  onOpenArticle: (article: FileItem) => void;
  onSelectWorkspace: () => void;
  evidence?: WorkbenchEvidence;
  onApproveArticle?: (input: {
    reviewerId: string;
    confirmedSourceHash: string;
    checklist: ReviewChecklist;
    warningsAcknowledged: string[];
  }) => Promise<boolean>;
  onTransitionArticle?: (status: ArticleStatus) => Promise<boolean>;
  onRevokeApproval?: (reviewerId: string) => Promise<boolean>;
  onPersistReceipt?: (
    receiptId: string,
    receipt: Record<string, unknown>,
  ) => Promise<boolean>;
  onAssetsChanged?: () => Promise<unknown> | unknown;
  qualityMetrics?: DashboardQualityMetrics;
}

export interface DashboardQualityMetrics {
  errorArticles: number;
  warningArticles: number;
  awaitingReview: number;
  invalidatedApprovals: number;
  unconfirmedAssetRights: number;
  publicationReady: number;
}

interface AssetOperationResult {
  success: boolean;
  canceled?: boolean;
  code?: string;
  error?: string;
  result?: unknown;
}

function titleOf(file: FileItem): string {
  return file.title?.trim() || file.name.replace(/\.md$/i, "");
}

function pathSlug(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const contentMatch = /(?:^|\/)content\/([^/]+)\/article\.md$/i.exec(
    normalized,
  );
  return (
    contentMatch?.[1] ??
    normalized.split("/").at(-1)?.replace(/\.md$/i, "") ??
    path
  );
}

function EmptyWorkspace({ onSelect }: { onSelect: () => void }) {
  return (
    <div className="workspace-hub__empty">
      <FolderOpen size={28} strokeWidth={1.5} />
      <strong>Choose a local workspace</strong>
      <p>Articles, assets, builds, and receipts stay in your project folder.</p>
      <button
        type="button"
        className="workspace-hub__primary"
        onClick={onSelect}
      >
        Select workspace
      </button>
    </div>
  );
}

function DashboardView({
  articles,
  workspacePath,
  onCreateArticle,
  onOpenArticle,
  onSelectWorkspace,
  qualityMetrics,
}: Omit<WorkspaceHubProps, "view" | "currentFile">) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [themeFilter, setThemeFilter] = useState("all");
  const statusCounts = useMemo(
    () =>
      Object.fromEntries(
        ["draft", "reviewing", "reviewed", "approved"].map((status) => [
          status,
          articles.filter((article) => article.status === status).length,
        ]),
      ),
    [articles],
  );
  const themes = useMemo(
    () =>
      [
        ...new Set(articles.map((article) => article.themeId).filter(Boolean)),
      ].sort(),
    [articles],
  );
  const visibleArticles = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return articles.filter((article) => {
      if (statusFilter !== "all" && article.status !== statusFilter)
        return false;
      if (themeFilter !== "all" && article.themeId !== themeFilter)
        return false;
      return (
        !needle ||
        titleOf(article).toLocaleLowerCase().includes(needle) ||
        pathSlug(article.path).toLocaleLowerCase().includes(needle)
      );
    });
  }, [articles, query, statusFilter, themeFilter]);

  return (
    <>
      <header className="workspace-hub__hero">
        <div>
          <span className="workspace-hub__eyebrow">CONTENT PIPELINE</span>
          <h1>Reviewable work, from source to draft.</h1>
          <p>
            MPForge turns Markdown into a reviewed, reproducible and auditable
            WeChat draft.
          </p>
        </div>
        <div className="workspace-hub__hero-actions">
          <button type="button" onClick={onSelectWorkspace}>
            <FolderOpen size={16} /> Workspace
          </button>
          <button
            type="button"
            className="workspace-hub__primary"
            onClick={onCreateArticle}
          >
            <FilePlus2 size={16} /> New article
          </button>
        </div>
      </header>

      <section
        className="workspace-hub__metrics"
        aria-label="Workspace summary"
      >
        <article>
          <span>Articles</span>
          <strong>{articles.length}</strong>
          <small>Git-tracked sources</small>
        </article>
        <article>
          <span>Draft</span>
          <strong>{statusCounts.draft}</strong>
          <small>可继续编辑</small>
        </article>
        <article>
          <span>Reviewing / Reviewed</span>
          <strong>
            {statusCounts.reviewing} / {statusCounts.reviewed}
          </strong>
          <small>审阅中 / 已审阅</small>
        </article>
        <article>
          <span>Approved</span>
          <strong>{statusCounts.approved}</strong>
          <small>只允许显式人工批准</small>
        </article>
        <article>
          <span>最近构建状态</span>
          <strong>未记录</strong>
          <small>打开文章并执行“构建 HTML”后更新</small>
        </article>
        <article>
          <span>ERROR articles</span>
          <strong>{qualityMetrics?.errorArticles ?? 0}</strong>
          <small>Approval blocked</small>
        </article>
        <article>
          <span>WARNING articles</span>
          <strong>{qualityMetrics?.warningArticles ?? 0}</strong>
          <small>Reviewer acknowledgement required</small>
        </article>
        <article>
          <span>Awaiting review</span>
          <strong>{qualityMetrics?.awaitingReview ?? 0}</strong>
          <small>reviewing / reviewed</small>
        </article>
        <article>
          <span>Invalidated approvals</span>
          <strong>{qualityMetrics?.invalidatedApprovals ?? 0}</strong>
          <small>Re-review required</small>
        </article>
        <article>
          <span>Unconfirmed image rights</span>
          <strong>{qualityMetrics?.unconfirmedAssetRights ?? 0}</strong>
          <small>pending / blocked / unknown</small>
        </article>
        <article>
          <span>Publication ready</span>
          <strong>{qualityMetrics?.publicationReady ?? 0}</strong>
          <small>Current human approval only</small>
        </article>
      </section>

      <section className="workspace-hub__panel">
        <div className="workspace-hub__panel-heading">
          <div>
            <span className="workspace-hub__eyebrow">ARTICLES</span>
            <h2>Content workspace</h2>
          </div>
          <span className="workspace-hub__legend">
            <span className="workspace-hub__status-dot" /> local first
          </span>
        </div>
        <div className="workspace-hub__filters" aria-label="文章搜索与筛选">
          <input
            type="search"
            aria-label="搜索文章"
            placeholder="搜索标题或 slug"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <select
            aria-label="按状态筛选"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="all">全部状态</option>
            {["idea", "draft", "reviewing", "reviewed", "approved"].map(
              (status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ),
            )}
          </select>
          <select
            aria-label="按主题筛选"
            value={themeFilter}
            onChange={(event) => setThemeFilter(event.target.value)}
          >
            <option value="all">全部主题</option>
            {themes.map((theme) => (
              <option key={theme} value={theme}>
                {theme}
              </option>
            ))}
          </select>
        </div>
        {!workspacePath ? (
          <EmptyWorkspace onSelect={onSelectWorkspace} />
        ) : articles.length === 0 ? (
          <div className="workspace-hub__empty">
            <FileCode2 size={28} strokeWidth={1.5} />
            <strong>No Markdown articles yet</strong>
            <p>Create an article to establish its Content-as-Code directory.</p>
          </div>
        ) : (
          <div className="workspace-hub__article-list">
            {visibleArticles.map((article) => (
              <button
                type="button"
                key={article.path}
                className="workspace-hub__article"
                onClick={() => onOpenArticle(article)}
              >
                <span className="workspace-hub__article-icon">
                  <FileCode2 size={18} />
                </span>
                <span className="workspace-hub__article-main">
                  <strong>{titleOf(article)}</strong>
                  <small>{pathSlug(article.path)}</small>
                </span>
                <span className="workspace-hub__badge">
                  {article.status ?? "unknown"}
                </span>
                <span className="workspace-hub__article-time">
                  <Clock3 size={13} /> {article.updatedAt.toLocaleDateString()}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function ReviewView({
  currentFile,
  evidence,
  onApproveArticle,
  onTransitionArticle,
  onRevokeApproval,
}: Pick<
  WorkspaceHubProps,
  | "currentFile"
  | "evidence"
  | "onApproveArticle"
  | "onTransitionArticle"
  | "onRevokeApproval"
>) {
  const [approving, setApproving] = useState(false);
  const [reviewerId, setReviewerId] = useState("");
  const [checklist, setChecklist] = useState<ReviewChecklist>({
    ...EMPTY_REVIEW_CHECKLIST,
  });
  const [transitioning, setTransitioning] = useState<ArticleStatus | null>(
    null,
  );
  const active = evidence ?? buildWorkbenchEvidence({});
  const checklistComplete = REVIEW_CHECKLIST_KEYS.every(
    (key) => checklist[key],
  );
  const rightsReady = active.assets.every(
    (asset) => asset.rightsStatus === "approved",
  );
  const canApprove =
    active.status === "reviewed" &&
    active.reviewReady &&
    rightsReady &&
    Boolean(active.preview?.chromiumComplete) &&
    !active.preview?.stale &&
    checklistComplete &&
    reviewerId.trim().length > 0 &&
    !approving;
  const approve = async () => {
    if (!canApprove || !onApproveArticle) return;
    setApproving(true);
    try {
      await onApproveArticle({
        reviewerId: reviewerId.trim(),
        confirmedSourceHash: active.sourceHash,
        checklist,
        warningsAcknowledged: (active.lint?.issues ?? [])
          .filter((issue) => issue.severity === "WARNING")
          .map((issue) => issue.fingerprint),
      });
    } finally {
      setApproving(false);
    }
  };
  const move = async (target: ArticleStatus) => {
    if (!onTransitionArticle || transitioning) return;
    setTransitioning(target);
    try {
      await onTransitionArticle(target);
    } finally {
      setTransitioning(null);
    }
  };
  const transitionActions: Array<{ target: ArticleStatus; label: string }> =
    active.status === "idea"
      ? [{ target: "draft", label: "Move to draft" }]
      : active.status === "draft"
        ? [{ target: "reviewing", label: "Request review" }]
        : active.status === "reviewing"
          ? [
              { target: "draft", label: "Return to draft" },
              { target: "reviewed", label: "Mark reviewed" },
            ]
          : active.status === "reviewed"
            ? [{ target: "draft", label: "Return to draft" }]
            : [];
  return (
    <section className="workspace-hub__split">
      <article className="workspace-hub__panel">
        <span className="workspace-hub__eyebrow">REVIEW</span>
        <h2>Article Summary</h2>
        <h1>
          {currentFile ? titleOf(currentFile) : "Open an article to review"}
        </h1>
        <p className="workspace-hub__lead">
          Source checks, deterministic lint findings, visual diffs, and human
          approval are collected here.
        </p>
        <div className="workspace-hub__checklist">
          <span data-ready={active.available}>
            <GitCommitHorizontal size={16} /> Status: {active.status}
          </span>
          <span data-ready={active.lint?.summary.errors === 0}>
            <ShieldCheck size={16} /> Linter:{" "}
            {active.lint?.summary.errors ?? "—"} ERROR ·{" "}
            {active.lint?.summary.warnings ?? "—"} WARNING
          </span>
          <span
            data-ready={Boolean(
              active.preview?.chromiumComplete && !active.preview.stale,
            )}
          >
            <ImageIcon size={16} /> Chromium preview{" "}
            {active.preview?.stale
              ? "STALE"
              : active.preview?.chromiumComplete
                ? "verified"
                : "required"}
          </span>
          <span>
            <LockKeyhole size={16} /> AI cannot grant approval
          </span>
        </div>
        <div className="workspace-hub__evidence" aria-label="Review evidence">
          <span>
            <strong>validation_status</strong>
            {active.available
              ? active.frontmatterValid
                ? "valid"
                : "invalid"
              : "unavailable"}
          </span>
          <span>
            <strong>lint_summary</strong>
            {active.lint
              ? `${active.lint.summary.errors} ERROR / ${active.lint.summary.warnings} WARNING`
              : "not run"}
          </span>
          <span>
            <strong>build_status</strong>
            {active.preview?.stale
              ? `STALE: ${active.preview.staleReasons.join(", ")}`
              : active.preview?.chromiumComplete
                ? "Chromium screenshots verified"
                : "Chromium preview not verified"}
          </span>
          <span>
            <strong>Source Hash</strong>
            {active.light?.sourceHash ?? "unavailable"}
          </span>
          <span>
            <strong>Build Hash</strong>
            {active.light?.renderedHtmlHash ?? "unavailable"}
          </span>
          <span>
            <strong>Title / Author</strong>
            {active.title} / {active.author || "unavailable"}
          </span>
          <span>
            <strong>Theme / Updated</strong>
            {active.theme} / {active.updatedAt || "unavailable"}
          </span>
        </div>
        {active.preview && (
          <div
            className="workspace-hub__preview-report"
            data-stale={active.preview.stale}
          >
            <header>
              <strong>
                {active.preview.stale ? "STALE PREVIEW" : "CURRENT PREVIEW"}
              </strong>
              <span>{active.preview.report.preview_version}</span>
            </header>
            <div className="workspace-hub__evidence">
              <span>
                <strong>generated_at</strong>
                {active.preview.report.generated_at}
              </span>
              <span>
                <strong>report_binding_hash</strong>
                {active.preview.report.report_binding_hash}
              </span>
              <span>
                <strong>source_hash</strong>
                {active.preview.report.source_hash}
              </span>
              <span>
                <strong>rendered_html_hash</strong>
                {active.preview.report.rendered_html_hash}
              </span>
              <span>
                <strong>stage_hashes</strong>
                raw {active.preview.report.stage_hashes.raw} · safe{" "}
                {active.preview.report.stage_hashes.safe} · wechat{" "}
                {active.preview.report.stage_hashes.wechat}
              </span>
              <span>
                <strong>layout / runtime</strong>
                overflow {String(
                  active.preview.report.horizontal_overflow,
                )} · {active.preview.report.overflow_elements.length} elements ·{" "}
                {active.preview.report.contrast_warnings.length} contrast ·{" "}
                {active.preview.report.missing_images.length} missing ·{" "}
                {active.preview.report.console_errors.length} console ·{" "}
                {active.preview.report.page_errors.length} page
              </span>
            </div>
            <p>{active.preview.report.compatibility_notice}</p>
          </div>
        )}
        {active.previewError && !active.preview && (
          <p className="workspace-hub__preview-error" role="alert">
            Chromium preview unavailable: {active.previewError}
          </p>
        )}
        {active.preview && (
          <div
            className="workspace-hub__preview-grid"
            aria-label="Chromium preview screenshots"
          >
            {active.preview.screenshots.map((screenshot) => {
              const entry = active.preview!.report.previews.find(
                (candidate) => candidate.screenshot === screenshot.name,
              );
              return (
                <figure key={screenshot.name}>
                  <figcaption>
                    {entry?.stage ?? "unknown"} · {entry?.mode ?? "unknown"} ·{" "}
                    {entry?.viewport.width ?? "?"}px · SHA-256{" "}
                    {screenshot.sha256}
                  </figcaption>
                  {screenshot.dataUrl ? (
                    <img
                      src={screenshot.dataUrl}
                      alt={`${entry?.stage ?? "Chromium"} ${entry?.mode ?? ""} ${entry?.viewport.width ?? ""}px preview`}
                    />
                  ) : (
                    <p>Screenshot file: {screenshot.name}</p>
                  )}
                </figure>
              );
            })}
          </div>
        )}
        {active.lint && active.lint.issues.length > 0 && (
          <div className="workspace-hub__findings" aria-label="Linter findings">
            {active.lint.issues.slice(0, 6).map((issue) => (
              <span
                key={`${issue.code}-${issue.location?.line ?? 0}`}
                data-severity={issue.severity}
              >
                <strong>{issue.severity}</strong> {issue.code} · {issue.message}
              </span>
            ))}
          </div>
        )}
      </article>
      <aside className="workspace-hub__panel workspace-hub__gate">
        <span className="workspace-hub__eyebrow">HUMAN GATE</span>
        <AlertTriangle size={26} />
        <h2>
          {active.status === "approved"
            ? "Human approval recorded"
            : canApprove
              ? "Ready for human approval"
              : "Approval remains locked"}
        </h2>
        <p>
          Approval requires reviewed status, zero ERROR, rights-approved assets,
          current build evidence, and every human confirmation.
        </p>
        {active.approvalInvalidated && active.status !== "approved" && (
          <p
            role="alert"
            data-invalidation-reason={active.approvalInvalidationReason}
          >
            Approval invalidated — re-review required. Reason:{" "}
            {active.approvalInvalidationReason ?? "unknown"}; previous approval:{" "}
            {active.previousApprovalId ?? "unknown"}.
          </p>
        )}
        <label className="workspace-hub__reviewer">
          Human reviewer ID
          <input
            value={reviewerId}
            onChange={(event) => setReviewerId(event.target.value)}
            autoComplete="off"
          />
        </label>
        <fieldset className="workspace-hub__human-checklist">
          <legend>Human checklist</legend>
          {REVIEW_CHECKLIST_KEYS.map((key) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={checklist[key]}
                onChange={(event) =>
                  setChecklist((current) => ({
                    ...current,
                    [key]: event.target.checked,
                  }))
                }
              />
              {key.replaceAll("_", " ")}
            </label>
          ))}
        </fieldset>
        {!rightsReady && (
          <p role="alert">Asset rights are not fully approved.</p>
        )}
        {transitionActions.length > 0 && (
          <div className="workspace-hub__transition-actions">
            {transitionActions.map((action) => (
              <button
                type="button"
                key={action.target}
                disabled={!onTransitionArticle || Boolean(transitioning)}
                onClick={() => void move(action.target)}
              >
                {transitioning === action.target ? "Updating…" : action.label}
              </button>
            ))}
          </div>
        )}
        {active.status === "approved" && (
          <button
            type="button"
            disabled={!onRevokeApproval || !reviewerId.trim() || approving}
            onClick={() => void onRevokeApproval?.(reviewerId.trim())}
          >
            Revoke approval
          </button>
        )}
        <button
          type="button"
          disabled={!canApprove || !onApproveArticle}
          onClick={() => void approve()}
        >
          {approving ? "Recording approval…" : "Approve article"}
        </button>
      </aside>
    </section>
  );
}

function AssetsView({
  currentFile,
  evidence,
  onAssetsChanged,
}: Pick<WorkspaceHubProps, "currentFile" | "evidence" | "onAssetsChanged">) {
  const assets = evidence?.assets ?? [];
  const [actor, setActor] = useState("");
  const [sourceType, setSourceType] = useState<
    "local" | "generated" | "user_owned" | "project_asset"
  >("local");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [license, setLicense] = useState("");
  const [creator, setCreator] = useState("");
  const [attribution, setAttribution] = useState("");
  const [generationMethod, setGenerationMethod] = useState("");
  const [ownershipConfirmed, setOwnershipConfirmed] = useState(false);
  const [remoteAcknowledged, setRemoteAcknowledged] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const api = isPublicDemoMode ? undefined : window.electron?.assets;
  const run = async (
    name: string,
    action: () => Promise<AssetOperationResult>,
  ) => {
    setBusy(name);
    setMessage(null);
    try {
      const response = await action();
      if (!response.success) {
        if (response.canceled) return;
        throw new Error(
          response.error || response.code || "Asset operation failed.",
        );
      }
      await onAssetsChanged?.();
      setMessage(`${name} completed through @mpforge/media.`);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Asset operation failed.",
      );
    } finally {
      setBusy(null);
    }
  };
  const common = currentFile
    ? {
        articlePath: currentFile.path,
        importedBy: actor.trim(),
        license: license.trim() || null,
        creator: creator.trim() || null,
        attribution: attribution.trim() || null,
      }
    : null;
  return (
    <section className="workspace-hub__panel">
      <span className="workspace-hub__eyebrow">ASSET PROVENANCE</span>
      <h1>
        {currentFile ? `${titleOf(currentFile)} assets` : "Article assets"}
      </h1>
      <p className="workspace-hub__lead">
        Local paths, source records, dimensions, SHA-256 hashes, deduplication,
        and upload status appear here. Network images are never imported
        implicitly.
      </p>
      <div
        className="workspace-hub__asset-import"
        aria-label="Asset import controls"
      >
        <label>
          Human actor
          <input
            value={actor}
            onChange={(event) => setActor(event.target.value)}
          />
        </label>
        <label>
          Local source type
          <select
            value={sourceType}
            onChange={(event) =>
              setSourceType(event.target.value as typeof sourceType)
            }
          >
            <option value="local">local</option>
            <option value="project_asset">project_asset</option>
            <option value="user_owned">user_owned</option>
            <option value="generated">generated</option>
          </select>
        </label>
        <label>
          Creator
          <input
            value={creator}
            onChange={(event) => setCreator(event.target.value)}
          />
        </label>
        <label>
          License
          <input
            value={license}
            onChange={(event) => setLicense(event.target.value)}
          />
        </label>
        <label>
          Attribution
          <input
            value={attribution}
            onChange={(event) => setAttribution(event.target.value)}
          />
        </label>
        {sourceType === "generated" && (
          <label>
            Generation method
            <input
              value={generationMethod}
              onChange={(event) => setGenerationMethod(event.target.value)}
            />
          </label>
        )}
        {sourceType === "user_owned" && (
          <label className="workspace-hub__asset-confirm">
            <input
              type="checkbox"
              checked={ownershipConfirmed}
              onChange={(event) => setOwnershipConfirmed(event.target.checked)}
            />
            I explicitly confirm this file is user-owned.
          </label>
        )}
        <button
          type="button"
          disabled={
            !api ||
            !common ||
            !actor.trim() ||
            Boolean(busy) ||
            (sourceType === "generated" && !generationMethod.trim()) ||
            (sourceType === "user_owned" && !ownershipConfirmed)
          }
          onClick={() =>
            void run("Local import", () =>
              api!.importLocal({
                ...common!,
                sourceType,
                generationMethod: generationMethod.trim() || undefined,
                userOwnedConfirmed: ownershipConfirmed,
              }),
            )
          }
        >
          {busy === "Local import"
            ? "Importing…"
            : "Choose and import local image"}
        </button>
        <label className="workspace-hub__asset-remote">
          Remote image URL (never fetched until import is clicked)
          <input
            type="url"
            value={remoteUrl}
            onChange={(event) => setRemoteUrl(event.target.value)}
            placeholder="https://example.com/image.png"
          />
        </label>
        <label className="workspace-hub__asset-confirm">
          <input
            type="checkbox"
            checked={remoteAcknowledged}
            onChange={(event) => setRemoteAcknowledged(event.target.checked)}
          />
          I acknowledge rights still require separate human approval.
        </label>
        <button
          type="button"
          disabled={
            !api ||
            !common ||
            !actor.trim() ||
            !remoteUrl.trim() ||
            !remoteAcknowledged ||
            Boolean(busy)
          }
          onClick={() =>
            void run("Remote import", () =>
              api!.importRemote({
                ...common!,
                sourceUrl: remoteUrl.trim(),
                rightsAcknowledged: true,
              }),
            )
          }
        >
          {busy === "Remote import"
            ? "Importing…"
            : "Explicitly import remote image"}
        </button>
        <div className="workspace-hub__asset-actions">
          <button
            type="button"
            disabled={!api || !currentFile || Boolean(busy)}
            onClick={() =>
              void run("Asset scan", () =>
                api!.scan({ articlePath: currentFile!.path }),
              )
            }
          >
            Scan (offline)
          </button>
          <button
            type="button"
            disabled={!api || !currentFile || Boolean(busy)}
            onClick={() =>
              void run("Derived image build", () =>
                api!.optimize({ articlePath: currentFile!.path }),
              )
            }
          >
            Build derived images / clean privacy metadata
          </button>
        </div>
      </div>
      {!api && (
        <p role="alert">
          Asset imports require the controlled desktop backend; browser code
          cannot edit the manifest or fetch remote images.
        </p>
      )}
      {message && <p className="workspace-hub__asset-message">{message}</p>}
      {assets.length === 0 ? (
        <div className="workspace-hub__empty workspace-hub__empty--compact">
          <ImageIcon size={28} strokeWidth={1.5} />
          <strong>No referenced assets for the current article</strong>
          <p>
            Open an article with local image references to run the inventory.
          </p>
        </div>
      ) : (
        <div className="workspace-hub__asset-list">
          {assets.map((asset) => (
            <article key={asset.reference} data-exists={asset.exists}>
              <ImageIcon aria-label={`Asset ${asset.reference}`} size={20} />
              <span>
                <strong>{asset.reference}</strong>
                <small>{asset.path}</small>
              </span>
              <span>
                <strong>Original source</strong>
                <small>{asset.originalSource}</small>
              </span>
              <span>
                <strong>Creator / License</strong>
                <small>
                  {asset.creator ?? "unknown"} / {asset.license ?? "unknown"}
                </small>
              </span>
              <span>
                <strong>Attribution</strong>
                <small>{asset.attribution ?? "not recorded"}</small>
              </span>
              <span>
                <strong>rights_status</strong>
                <small>{asset.rightsStatus ?? "unknown"}</small>
              </span>
              <span>
                <strong>{asset.exists ? "Local" : "Missing"}</strong>
                <small>
                  {asset.sizeBytes
                    ? `${asset.sizeBytes} bytes`
                    : "size unavailable"}
                </small>
              </span>
              <span>
                <strong>SHA-256</strong>
                <small>{asset.sha256 ?? "computed by media build"}</small>
              </span>
              <span>
                <strong>Processing / privacy</strong>
                <small>
                  {asset.processed ? "processed" : "original only"} ·{" "}
                  {asset.privacyMetadataPresent
                    ? "privacy metadata present"
                    : "no privacy metadata detected"}
                </small>
              </span>
              <span>
                <strong>Size before / after</strong>
                <small>
                  {asset.originalSizeBytes ?? "unknown"} /{" "}
                  {asset.optimizedSizeBytes ?? "not optimized"}
                </small>
              </span>
              {asset.assetId && currentFile && api && (
                <AssetRightsEditor
                  articlePath={currentFile.path}
                  asset={asset}
                  onChanged={onAssetsChanged}
                />
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function AssetRightsEditor({
  articlePath,
  asset,
  onChanged,
}: {
  articlePath: string;
  asset: NonNullable<WorkbenchEvidence["assets"]>[number];
  onChanged?: () => Promise<unknown> | unknown;
}) {
  const [status, setStatus] = useState(asset.rightsStatus ?? "pending");
  const [license, setLicense] = useState(asset.license ?? "");
  const [creator, setCreator] = useState(asset.creator ?? "");
  const [attribution, setAttribution] = useState(asset.attribution ?? "");
  const [confirmed, setConfirmed] = useState(false);
  const [ownershipConfirmed, setOwnershipConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (isPublicDemoMode || !asset.assetId || !window.electron?.assets) return;
    setSaving(true);
    setError(null);
    try {
      const response = await window.electron.assets.updateRights({
        articlePath,
        assetId: asset.assetId,
        rightsStatus: status,
        confirmedByHuman: status === "approved" ? confirmed : undefined,
        userOwnedConfirmed:
          asset.sourceType === "user_owned" && status === "approved"
            ? ownershipConfirmed
            : undefined,
        license: license.trim() || null,
        creator: creator.trim() || null,
        attribution: attribution.trim() || null,
      });
      if (!response.success)
        throw new Error(response.error || "Rights update failed.");
      await onChanged?.();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Rights update failed.",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <fieldset className="workspace-hub__asset-rights">
      <legend>Human rights record</legend>
      <select
        value={status}
        onChange={(event) => setStatus(event.target.value as typeof status)}
      >
        <option value="pending">pending</option>
        <option value="approved">approved</option>
        <option value="blocked">blocked</option>
        <option value="unknown">unknown</option>
      </select>
      <input
        aria-label="Rights creator"
        value={creator}
        onChange={(event) => setCreator(event.target.value)}
        placeholder="Creator"
      />
      <input
        aria-label="Rights license"
        value={license}
        onChange={(event) => setLicense(event.target.value)}
        placeholder="License"
      />
      <input
        aria-label="Rights attribution"
        value={attribution}
        onChange={(event) => setAttribution(event.target.value)}
        placeholder="Attribution"
      />
      {status === "approved" && (
        <label>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          Human rights review confirmed
        </label>
      )}
      {status === "approved" && asset.sourceType === "user_owned" && (
        <label>
          <input
            type="checkbox"
            checked={ownershipConfirmed}
            onChange={(event) => setOwnershipConfirmed(event.target.checked)}
          />
          User ownership confirmed
        </label>
      )}
      <button
        type="button"
        disabled={
          saving ||
          (status === "approved" &&
            (!confirmed ||
              (asset.sourceType === "user_owned" && !ownershipConfirmed)))
        }
        onClick={() => void save()}
      >
        {saving ? "Saving…" : "Save rights record"}
      </button>
      {error && <small role="alert">{error}</small>}
    </fieldset>
  );
}

function PublishView({
  currentFile,
  evidence,
}: Pick<WorkspaceHubProps, "currentFile" | "evidence">) {
  const active = evidence ?? buildWorkbenchEvidence({});
  return <Round3DraftWorkspace currentFile={currentFile} evidence={active} />;
}

function SettingsView({
  workspacePath,
}: Pick<WorkspaceHubProps, "workspacePath">) {
  return (
    <section className="workspace-hub__panel">
      <span className="workspace-hub__eyebrow">LOCAL-FIRST SETTINGS</span>
      <h1>Workspace and safety</h1>
      <div className="workspace-hub__settings-grid">
        <article>
          <strong>Content root</strong>
          <span>{workspacePath ?? "Not selected"}</span>
        </article>
        <article>
          <strong>Credentials</strong>
          <span>Environment only · values never displayed</span>
        </article>
        <article>
          <strong>Default publish mode</strong>
          <span>Mock Draft</span>
        </article>
        <article>
          <strong>Theme source</strong>
          <span>Versioned workspace files</span>
        </article>
      </div>
    </section>
  );
}

export function WorkspaceHub(props: WorkspaceHubProps) {
  const selectedArticlePath = useAppViewStore(
    (state) => state.selectedArticlePath,
  );
  const currentFile =
    props.currentFile ??
    props.articles.find((article) => article.path === selectedArticlePath) ??
    null;

  return (
    <main className="workspace-hub" data-view={props.view}>
      {props.view === "dashboard" && <DashboardView {...props} />}
      {props.view === "review" && (
        <ReviewView
          currentFile={currentFile}
          evidence={props.evidence}
          onApproveArticle={props.onApproveArticle}
          onTransitionArticle={props.onTransitionArticle}
          onRevokeApproval={props.onRevokeApproval}
        />
      )}
      {props.view === "assets" && (
        <AssetsView
          currentFile={currentFile}
          evidence={props.evidence}
          onAssetsChanged={props.onAssetsChanged}
        />
      )}
      {props.view === "publish" && (
        <PublishView currentFile={currentFile} evidence={props.evidence} />
      )}
      {props.view === "settings" && (
        <SettingsView workspacePath={props.workspacePath} />
      )}
    </main>
  );
}
