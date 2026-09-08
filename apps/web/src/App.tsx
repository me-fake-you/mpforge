import type { CSSProperties } from "react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Toaster } from "react-hot-toast";
import { Header } from "./components/Header/Header";
import {
  WorkspaceHub,
  type DashboardQualityMetrics,
} from "./components/AppShell/WorkspaceHub";
import { WorkspaceNavigation } from "./components/AppShell/WorkspaceNavigation";
import { FileSidebar } from "./components/Sidebar/FileSidebar";
import { EditorPreviewWorkspace } from "./components/Workspace/EditorPreviewWorkspace";
import {
  DEFAULT_MIN_PREVIEW_WIDTH,
  getDesktopAppMinWidth,
} from "./components/Workspace/useSplitPane";
import { useFileSystem } from "./hooks/useFileSystem";
import { useMobileView } from "./hooks/useMobileView";
import { MobileToolbar } from "./components/common/MobileToolbar";
import { useEditorStore } from "./store/editorStore";
import "./styles/global.css";
import "./App.css";

import { useStorageContext } from "./storage/StorageContext";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { useHistoryStore } from "./store/historyStore";
import { useFileStore } from "./store/fileStore";
import type { FileItem } from "./store/fileTypes";
import { useAppViewStore } from "./store/appViewStore";
import { platform } from "./lib/platformAdapter";

const HistoryPanel = lazy(() =>
  import("./components/History/HistoryPanel").then((m) => ({
    default: m.HistoryPanel,
  })),
);
const HistoryManager = lazy(() =>
  import("./components/History/HistoryManager").then((m) => ({
    default: m.HistoryManager,
  })),
);
const Welcome = lazy(() =>
  import("./components/Welcome/Welcome").then((m) => ({ default: m.Welcome })),
);
const UpdateModal = lazy(() =>
  import("./components/UpdateModal/UpdateModal").then((m) => ({
    default: m.UpdateModal,
  })),
);
import { MobileThemeSelector } from "./components/Theme/MobileThemeSelector";
import { WorkspaceThemeMergePrompt } from "./components/Theme/WorkspaceThemeMergePrompt";
import { useThemeStore } from "./store/themeStore";
import { createWorkspaceThemeBackend } from "./services/theme/themeStorageBackend";
import {
  applyMarkdownFileMeta,
  parseMarkdownFileContent,
  stripMarkdownExtension,
} from "./utils/markdownFileMeta";
import { buildWorkbenchEvidence } from "./services/mpforgeWorkbench";
import {
  bindPreviewEvidence,
  type PreviewScreenshotEvidence,
} from "./services/previewEvidence";
import { parseArticleDocument } from "@mpforge/content-schema";
import { isPublicDemoMode } from "./demo/demoMode";
import { seedPublicDemoWorkspace } from "./demo/demoSeed";

interface UpdateEventData {
  latestVersion: string;
  currentVersion: string;
  releaseNotes?: string;
  force?: boolean;
}

interface ElectronUpdateAPI {
  onUpdateAvailable?: (callback: (data: UpdateEventData) => void) => () => void;
  onUpToDate?: (
    callback: (data: { currentVersion: string }) => void,
  ) => () => void;
  onUpdateError?: (callback: () => void) => () => void;
  removeUpdateListener?: (handler: (() => void) | undefined) => void;
  openReleases?: () => void;
}

function App() {
  const {
    workspacePath,
    files,
    currentFile,
    saveFile,
    openFile,
    createContentArticle,
    approveCurrentArticle,
    revokeCurrentApproval,
    updateCurrentArticleSource,
    buildCurrentArticle,
    transitionCurrentArticle,
    persistCurrentReceipt,
    readWorkspaceTextFile,
    refreshFiles,
    selectWorkspace,
    flattenFiles,
  } = useFileSystem({ enableEffects: true });
  const { adapter, type: storageType, ready } = useStorageContext();
  const historyLoading = useHistoryStore((state) => state.loading);
  const fileLoading = useFileStore((state) => state.isLoading);
  const workspaceRevision = useFileStore((state) => state.workspaceRevision);
  const {
    isMobile: isMobileScreen,
    activeView,
    setActiveView,
  } = useMobileView();
  const isMobile = isMobileScreen && !platform.isElectron;
  const copyToWechat = useEditorStore((state) => state.copyToWechat);
  const copyAsHtml = useEditorStore((state) => state.copyAsHtml);
  const markdown = useEditorStore((state) => state.markdown);
  const lastSavedContent = useFileStore((state) => state.lastSavedContent);
  const selectedTheme = useThemeStore((state) => state.themeId);
  const selectedThemeName = useThemeStore((state) => state.themeName);
  const [showThemePanel, setShowThemePanel] = useState(false);
  const [assetManifest, setAssetManifest] = useState("");
  const [localAssetFiles, setLocalAssetFiles] = useState<FileItem[]>([]);
  const [previewPayload, setPreviewPayload] = useState<{
    report: unknown | null;
    screenshots: PreviewScreenshotEvidence[];
    error: string | null;
  }>({ report: null, screenshots: [], error: null });
  const [approvalInvalidations, setApprovalInvalidations] = useState("");
  const [approvalRecords, setApprovalRecords] = useState("");
  const [dashboardQuality, setDashboardQuality] =
    useState<DashboardQualityMetrics>({
      errorArticles: 0,
      warningArticles: 0,
      awaitingReview: 0,
      invalidatedApprovals: 0,
      unconfirmedAssetRights: 0,
      publicationReady: 0,
    });
  const [approvalInvalidationRevision, setApprovalInvalidationRevision] =
    useState(0);
  const approvalInvalidationSignal = useRef(0);
  const approvalInvalidationArticle = useRef<string | null>(null);
  useEffect(() => {
    if (
      !isPublicDemoMode ||
      !ready ||
      storageType !== "indexeddb" ||
      !adapter
    ) {
      return;
    }
    let current = true;
    void seedPublicDemoWorkspace(adapter)
      .then((created) => {
        if (current && created) return refreshFiles();
      })
      .catch((error) => {
        console.error("Unable to seed the public demo workspace", error);
      });
    return () => {
      current = false;
    };
  }, [adapter, ready, refreshFiles, storageType]);
  useEffect(() => {
    const refreshInvalidation = (event: Event) => {
      if (event instanceof CustomEvent && event.detail) {
        approvalInvalidationSignal.current += 1;
        setApprovalInvalidations(`${JSON.stringify(event.detail)}\n`);
        return;
      }
      setApprovalInvalidationRevision((revision) => revision + 1);
    };
    window.addEventListener(
      "mpforge:approval-invalidated",
      refreshInvalidation,
    );
    return () =>
      window.removeEventListener(
        "mpforge:approval-invalidated",
        refreshInvalidation,
      );
  }, []);
  useEffect(() => {
    const recordApproval = (event: Event) => {
      if (event instanceof CustomEvent && event.detail) {
        setApprovalRecords(`${JSON.stringify(event.detail)}\n`);
      }
    };
    window.addEventListener("mpforge:approval-recorded", recordApproval);
    return () =>
      window.removeEventListener("mpforge:approval-recorded", recordApproval);
  }, []);
  const workspaceView = useAppViewStore((state) => state.activeView);
  const setWorkspaceView = useAppViewStore((state) => state.setActiveView);
  const selectArticleView = useAppViewStore((state) => state.openArticle);
  const allFiles = useMemo(() => flattenFiles(files), [files, flattenFiles]);
  useEffect(() => {
    let current = true;
    if (!currentFile) {
      setAssetManifest("");
      setLocalAssetFiles([]);
      setApprovalInvalidations("");
      setApprovalRecords("");
      approvalInvalidationArticle.current = null;
      return () => {
        current = false;
      };
    }
    if (approvalInvalidationArticle.current !== currentFile.path) {
      approvalInvalidationArticle.current = currentFile.path;
      approvalInvalidationSignal.current = 0;
      setApprovalInvalidations("");
      setApprovalRecords("");
    }
    const invalidationSignal = approvalInvalidationSignal.current;
    const separator = currentFile.path.includes("\\") ? "\\" : "/";
    const articleDirectory = currentFile.path.replace(/[\\/]article\.md$/i, "");
    void Promise.all([
      readWorkspaceTextFile(
        `${articleDirectory}${separator}assets${separator}manifest.json`,
      ),
      readWorkspaceTextFile(
        `${articleDirectory}${separator}history${separator}approval-invalidations.jsonl`,
      ),
      readWorkspaceTextFile(
        `${articleDirectory}${separator}history${separator}approvals.jsonl`,
      ),
      !isPublicDemoMode && window.electron?.assets?.listFiles
        ? window.electron.assets.listFiles({ articlePath: currentFile.path })
        : Promise.resolve({ success: true, result: [] }),
    ]).then(([manifest, invalidations, approvals, assetFileResponse]) => {
      if (!current) return;
      setAssetManifest(manifest ?? "");
      const listedFiles =
        assetFileResponse.success && Array.isArray(assetFileResponse.result)
          ? (
              assetFileResponse.result as Array<
                Omit<FileItem, "createdAt" | "updatedAt"> & {
                  createdAt: string | Date;
                  updatedAt: string | Date;
                }
              >
            ).map((file) => ({
              ...file,
              createdAt: new Date(file.createdAt),
              updatedAt: new Date(file.updatedAt),
            }))
          : [];
      setLocalAssetFiles(listedFiles);
      if (invalidationSignal === approvalInvalidationSignal.current) {
        if (invalidations?.trim()) {
          setApprovalInvalidations(invalidations);
        }
      }
      if (approvals?.trim()) setApprovalRecords(approvals);
    });
    return () => {
      current = false;
    };
  }, [
    allFiles,
    approvalInvalidationRevision,
    currentFile,
    readWorkspaceTextFile,
  ]);
  const articleFiles = useMemo(
    () =>
      allFiles.filter((file) => {
        const normalized = file.path.replace(/\\/g, "/").toLocaleLowerCase();
        return (
          file.name.toLocaleLowerCase() === "article.md" &&
          (normalized.startsWith("content/") ||
            normalized.includes("/content/"))
        );
      }),
    [allFiles],
  );
  const workbenchFiles = useMemo(
    () => [...allFiles, ...localAssetFiles],
    [allFiles, localAssetFiles],
  );
  useEffect(() => {
    let current = true;
    void Promise.all(
      articleFiles.map(async (article) => {
        const separator = article.path.includes("\\") ? "\\" : "/";
        const directory = article.path.replace(/[\\/]article\.md$/i, "");
        const [lintRaw, manifestRaw, approvalsRaw, invalidationsRaw] =
          await Promise.all([
            readWorkspaceTextFile(
              `${directory}${separator}build${separator}lint-report.json`,
            ),
            readWorkspaceTextFile(
              `${directory}${separator}assets${separator}manifest.json`,
            ),
            readWorkspaceTextFile(
              `${directory}${separator}history${separator}approvals.jsonl`,
            ),
            readWorkspaceTextFile(
              `${directory}${separator}history${separator}approval-invalidations.jsonl`,
            ),
          ]);
        const parseObject = (raw: string | null) => {
          try {
            return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
          } catch {
            return {};
          }
        };
        const parseLines = (raw: string | null) =>
          (raw ?? "")
            .split(/\r?\n/)
            .filter(Boolean)
            .flatMap((line) => {
              try {
                return [JSON.parse(line) as Record<string, unknown>];
              } catch {
                return [];
              }
            });
        const lint = parseObject(lintRaw);
        const manifest = parseObject(manifestRaw);
        const assets = Array.isArray(manifest.assets)
          ? (manifest.assets as Array<Record<string, unknown>>)
          : [];
        const approvals = parseLines(approvalsRaw);
        const invalidations = parseLines(invalidationsRaw);
        const invalidatedIds = new Set(
          invalidations
            .map((record) => record.previous_approval_id)
            .filter((id): id is string => typeof id === "string"),
        );
        const activeApproval = approvals.some(
          (record) =>
            typeof record.approval_id === "string" &&
            !invalidatedIds.has(record.approval_id),
        );
        const rightsReady = assets.every(
          (asset) => asset.rights_status === "approved",
        );
        const errors =
          typeof lint.error_count === "number"
            ? lint.error_count
            : Number.POSITIVE_INFINITY;
        const warnings =
          typeof lint.warning_count === "number" ? lint.warning_count : 0;
        return {
          errors,
          warnings,
          awaiting:
            article.status === "reviewing" || article.status === "reviewed",
          invalidated:
            approvals.length > 0 &&
            !activeApproval &&
            article.status !== "approved",
          unconfirmedRights: assets.some(
            (asset) => asset.rights_status !== "approved",
          ),
          ready:
            article.status === "approved" &&
            errors === 0 &&
            rightsReady &&
            activeApproval,
        };
      }),
    ).then((results) => {
      if (!current) return;
      setDashboardQuality({
        errorArticles: results.filter((result) => result.errors > 0).length,
        warningArticles: results.filter((result) => result.warnings > 0).length,
        awaitingReview: results.filter((result) => result.awaiting).length,
        invalidatedApprovals: results.filter((result) => result.invalidated)
          .length,
        unconfirmedAssetRights: results.filter(
          (result) => result.unconfirmedRights,
        ).length,
        publicationReady: results.filter((result) => result.ready).length,
      });
    });
    return () => {
      current = false;
    };
  }, [articleFiles, readWorkspaceTextFile, workspaceRevision]);
  const workbenchSource = useMemo(() => {
    if (!currentFile || !lastSavedContent) return "";
    let articleTheme = selectedTheme;
    let articleThemeName = selectedThemeName;
    if (selectedTheme === "default") {
      try {
        const persistedTheme =
          parseArticleDocument(lastSavedContent).frontmatter.theme;
        if (typeof persistedTheme === "string") {
          articleTheme = persistedTheme;
          articleThemeName = persistedTheme;
        }
      } catch {
        // Invalid raw Frontmatter remains visible to the editor/linter.
      }
    }
    const persisted = parseMarkdownFileContent(lastSavedContent);
    const currentTitle =
      currentFile.title || stripMarkdownExtension(currentFile.name);
    const persistedTitle =
      persisted.title || stripMarkdownExtension(currentFile.name);
    if (
      markdown === persisted.body &&
      articleTheme === persisted.theme &&
      currentTitle === persistedTitle
    ) {
      return lastSavedContent;
    }
    return applyMarkdownFileMeta(lastSavedContent, {
      body: markdown,
      theme: articleTheme,
      themeName: articleThemeName,
      title: currentTitle,
    });
  }, [
    currentFile,
    lastSavedContent,
    markdown,
    selectedTheme,
    selectedThemeName,
  ]);
  const baseWorkbenchEvidence = useMemo(
    () =>
      buildWorkbenchEvidence({
        articlePath: currentFile?.path,
        source: workbenchSource,
        files: workbenchFiles,
        assetManifest,
        approvalInvalidations,
        approvalRecords,
      }),
    [
      workbenchFiles,
      approvalInvalidations,
      approvalRecords,
      assetManifest,
      currentFile?.path,
      workbenchSource,
    ],
  );
  useEffect(() => {
    let current = true;
    if (!currentFile) {
      setPreviewPayload({ report: null, screenshots: [], error: null });
      return () => {
        current = false;
      };
    }
    const reportPath = `${currentFile.path.replace(/[\\/]article\.md$/i, "")}${
      currentFile.path.includes("\\") ? "\\" : "/"
    }build${currentFile.path.includes("\\") ? "\\" : "/"}preview-report.json`;
    const load = async () => {
      try {
        if (!isPublicDemoMode && window.electron?.review) {
          const response = await window.electron.review.loadPreview({
            articlePath: currentFile.path,
          });
          if (!response.success || !response.result) {
            throw new Error(
              response.error || "Chromium preview evidence is unavailable.",
            );
          }
          if (current) {
            setPreviewPayload({
              report: response.result.report,
              screenshots: response.result.screenshots,
              error: null,
            });
          }
          return;
        }
        const raw = await readWorkspaceTextFile(reportPath);
        if (!raw)
          throw new Error(
            "Run `mpforge preview <slug>` to generate Chromium evidence.",
          );
        if (current) {
          setPreviewPayload({
            report: JSON.parse(raw),
            screenshots: [],
            error: null,
          });
        }
      } catch (error) {
        if (current) {
          setPreviewPayload({
            report: null,
            screenshots: [],
            error:
              error instanceof Error
                ? error.message
                : "Preview evidence is unavailable.",
          });
        }
      }
    };
    void load();
    return () => {
      current = false;
    };
  }, [currentFile, readWorkspaceTextFile, workspaceRevision]);
  const previewEvidence = useMemo(() => {
    if (!previewPayload.report) return null;
    try {
      return bindPreviewEvidence({
        report: previewPayload.report,
        screenshots: previewPayload.screenshots.length
          ? previewPayload.screenshots
          : undefined,
        currentSourceHash: baseWorkbenchEvidence.sourceHash,
        currentRenderedHtmlHash:
          baseWorkbenchEvidence.light?.renderedHtmlHash ?? "",
      });
    } catch {
      return null;
    }
  }, [baseWorkbenchEvidence, previewPayload]);
  const workbenchEvidence = useMemo(
    () => ({
      ...baseWorkbenchEvidence,
      preview: previewEvidence,
      previewError: previewEvidence ? null : previewPayload.error,
    }),
    [baseWorkbenchEvidence, previewEvidence, previewPayload.error],
  );

  // 自定义主题真源在工作区文件夹，副作用单点启用
  useEffect(() => {
    const backend = createWorkspaceThemeBackend({
      storageType,
      storageReady: ready,
      adapter,
      workspacePath,
    });
    const themeStore = useThemeStore.getState();
    themeStore.setWorkspaceThemeBackend(backend);
    if (backend) void themeStore.loadWorkspaceThemes();
  }, [adapter, ready, storageType, workspacePath, workspaceRevision]);

  // 全局保存快捷键（统一监听器）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        saveFile(true); // showToast = true
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [saveFile]);

  const isElectron = platform.isElectron;

  // 更新提示状态
  const [updateInfo, setUpdateInfo] = useState<{
    latestVersion: string;
    currentVersion: string;
    releaseNotes: string;
  } | null>(null);

  // 监听 Electron 更新事件
  useEffect(() => {
    if (!isElectron) return;
    const electron = window.electron as { update?: ElectronUpdateAPI };
    if (!electron?.update?.onUpdateAvailable) return;

    const availableHandler = electron.update.onUpdateAvailable(
      (data: UpdateEventData) => {
        // 检查是否跳过了此版本（除非是强制检查）
        const skippedVersion = localStorage.getItem("wemd-skipped-version");
        if (!data.force && skippedVersion === data.latestVersion) {
          return; // 用户之前选择跳过此版本
        }

        setUpdateInfo({
          latestVersion: data.latestVersion,
          currentVersion: data.currentVersion,
          releaseNotes: data.releaseNotes || "",
        });
      },
    );

    const upToDateHandler = electron.update.onUpToDate?.(
      (data: { currentVersion: string }) => {
        // 使用 react-hot-toast 显示已是最新版本
        import("react-hot-toast").then(({ default: toast }) => {
          toast.success(`当前已是最新版本 (${data.currentVersion})`);
        });
      },
    );

    const errorHandler = electron.update.onUpdateError?.(() => {
      import("react-hot-toast").then(({ default: toast }) => {
        toast.error("检查更新失败，请稍后重试");
      });
    });

    return () => {
      electron.update?.removeUpdateListener?.(availableHandler);
      if (upToDateHandler)
        electron.update?.removeUpdateListener?.(upToDateHandler);
      if (errorHandler) electron.update?.removeUpdateListener?.(errorHandler);
    };
  }, [isElectron]);

  const [showHistory, setShowHistory] = useState(() => {
    if (typeof window === "undefined") return true;
    const saved = localStorage.getItem("wemd-show-history");
    return saved !== "false";
  });
  const [historyWidth, setHistoryWidth] = useState<string>(
    showHistory ? "256px" : "0px",
  );

  useEffect(() => {
    try {
      localStorage.setItem("wemd-show-history", String(showHistory));
    } catch {
      /* 忽略持久化错误 */
    }
  }, [showHistory]);

  useEffect(() => {
    if (showHistory) {
      setHistoryWidth("256px");
      return;
    }
    const timer = window.setTimeout(() => setHistoryWidth("0px"), 350);
    return () => window.clearTimeout(timer);
  }, [showHistory]);

  const handleHistoryToggle = () => {
    if (!showHistory) setHistoryWidth("256px");
    setShowHistory((visible) => !visible);
  };

  const mainClass = "app-main";
  const [desktopPreviewMinWidth, setDesktopPreviewMinWidth] = useState(
    DEFAULT_MIN_PREVIEW_WIDTH,
  );
  const appStyle = useMemo<CSSProperties | undefined>(
    () =>
      isMobile
        ? undefined
        : { minWidth: `${getDesktopAppMinWidth(desktopPreviewMinWidth)}px` },
    [desktopPreviewMinWidth, isMobile],
  );
  const mainStyle = useMemo(
    () =>
      ({
        "--history-width": historyWidth,
      }) as CSSProperties,
    [historyWidth],
  );

  // Electron 模式：强制选择工作区
  if (isElectron && !workspacePath) {
    return (
      <>
        <Toaster position="top-center" />
        <Suspense
          fallback={
            <div className="workspace-loading">
              <Loader2 className="animate-spin" size={24} />
            </div>
          }
        >
          <Welcome />
        </Suspense>
      </>
    );
  }

  return (
    <div
      className="app"
      data-layout-mode={isMobile ? "mobile" : "desktop"}
      style={appStyle}
    >
      {/* 更新提示 Modal */}
      {updateInfo && (
        <Suspense fallback={null}>
          <UpdateModal
            latestVersion={updateInfo.latestVersion}
            currentVersion={updateInfo.currentVersion}
            releaseNotes={updateInfo.releaseNotes}
            onClose={() => setUpdateInfo(null)}
            onDownload={() => {
              (
                window.electron as { update?: ElectronUpdateAPI }
              )?.update?.openReleases?.();
              setUpdateInfo(null);
            }}
            onSkipVersion={() => {
              localStorage.setItem(
                "wemd-skipped-version",
                updateInfo.latestVersion,
              );
              setUpdateInfo(null);
            }}
          />
        </Suspense>
      )}
      <WorkspaceThemeMergePrompt />

      {/* 只在存储上下文完全就绪且确认为 IndexedDB 模式时才渲染 HistoryManager */}
      {!isElectron && ready && storageType === "indexeddb" && (
        <Suspense fallback={null}>
          <HistoryManager />
        </Suspense>
      )}

      <>
        <Toaster
          position="top-center"
          toastOptions={{
            className: "premium-toast",
            style: {
              background: "rgba(255, 255, 255, 0.9)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              color: "#1a1a1a",
              boxShadow: "0 12px 30px -10px rgba(0, 0, 0, 0.12)",
              borderRadius: "10px",
              padding: "10px 20px",
              fontSize: "14px",
              fontWeight: 500,
              border: "1px solid rgba(0, 0, 0, 0.05)",
              maxWidth: "400px",
            },
            success: {
              iconTheme: {
                primary: "var(--accent-primary)",
                secondary: "var(--on-accent)",
              },
              duration: 2000,
            },
            error: {
              iconTheme: {
                primary: "#ef4444",
                secondary: "#fff",
              },
              duration: 3000,
            },
          }}
        />
        {isPublicDemoMode && (
          <div className="public-demo-banner" role="status">
            <strong>DEMO / MOCK</strong>
            <span>
              纯浏览器演示 · 仅使用内置示例和 Mock WeChat ·
              不读取真实凭据或调用真实微信
            </span>
          </div>
        )}
        <Header />
        <WorkspaceNavigation />
        {workspaceView === "editor" ? (
          <main
            className={mainClass}
            style={mainStyle}
            data-show-history={showHistory}
          >
            <button
              className={`history-toggle ${showHistory ? "" : "is-collapsed"}`}
              onClick={handleHistoryToggle}
              aria-label={showHistory ? "隐藏文件栏" : "显示文件栏"}
              title={showHistory ? "隐藏文件栏" : "显示文件栏"}
            >
              {showHistory ? (
                <ChevronLeft size={16} />
              ) : (
                <ChevronRight size={16} />
              )}
            </button>
            <div
              className={`history-pane ${showHistory ? "is-visible" : "is-hidden"}`}
              aria-hidden={!showHistory}
            >
              <div className="history-pane__content">
                {/* ready 后渲染，防止闪烁 */}
                {ready &&
                  (isElectron || storageType === "filesystem" ? (
                    <FileSidebar />
                  ) : (
                    <Suspense
                      fallback={
                        <div className="workspace-loading">
                          <Loader2 className="animate-spin" size={24} />
                        </div>
                      }
                    >
                      <HistoryPanel />
                    </Suspense>
                  ))}
              </div>
            </div>
            <EditorPreviewWorkspace
              loading={
                !ready ||
                fileLoading ||
                (historyLoading && !isElectron && storageType === "indexeddb")
              }
              mobileView={isMobile ? activeView : undefined}
              onPreviewMinimumWidthChange={setDesktopPreviewMinWidth}
              articleSource={workbenchSource}
              onSaveArticleSource={updateCurrentArticleSource}
              onBuildArticle={buildCurrentArticle}
            />

            {/* 移动端底部工具栏 */}
            {isMobile && (
              <MobileToolbar
                activeView={activeView}
                onViewChange={setActiveView}
                onCopyToWechat={copyToWechat}
                onCopyAsHtml={copyAsHtml}
                onOpenTheme={() => setShowThemePanel(true)}
              />
            )}
          </main>
        ) : (
          <WorkspaceHub
            view={workspaceView}
            articles={articleFiles}
            currentFile={currentFile}
            workspacePath={workspacePath}
            evidence={workbenchEvidence}
            qualityMetrics={dashboardQuality}
            onCreateArticle={() => {
              setWorkspaceView("editor");
              void createContentArticle();
            }}
            onOpenArticle={(article) => {
              selectArticleView(article.path);
              void openFile(article);
            }}
            onSelectWorkspace={() => void selectWorkspace()}
            onAssetsChanged={refreshFiles}
            onApproveArticle={(approval) =>
              approveCurrentArticle({
                ...approval,
                lintErrors: workbenchEvidence.lint?.summary.errors ?? 1,
                previewComplete: Boolean(
                  workbenchEvidence.preview?.chromiumComplete &&
                    !workbenchEvidence.preview.stale,
                ),
              })
            }
            onTransitionArticle={(status) => transitionCurrentArticle(status)}
            onRevokeApproval={revokeCurrentApproval}
            onPersistReceipt={persistCurrentReceipt}
          />
        )}
      </>

      {/* 移动端主题选择器 */}
      {isMobile && (
        <MobileThemeSelector
          open={showThemePanel}
          onClose={() => setShowThemePanel(false)}
        />
      )}
    </div>
  );
}

export default App;
