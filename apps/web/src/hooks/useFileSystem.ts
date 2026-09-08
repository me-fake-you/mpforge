import { useCallback, useRef } from "react";
import { useFileStore } from "../store/fileStore";
import { useEditorStore } from "../store/editorStore";
import { useThemeStore } from "../store/themeStore";
import { useStorageContext } from "../storage/StorageContext";
import type { FileItem } from "../store/fileTypes";
import toast from "react-hot-toast";
import {
  applyMarkdownFileMeta,
  buildMarkdownFileContent,
  parseMarkdownFileContent,
  stripMarkdownExtension,
} from "../utils/markdownFileMeta";
import { resolveNewArticleThemeSnapshot } from "../utils/newArticleTheme";
import {
  convertAdapterFilesToTreeItems,
  convertToTreeItems,
  flattenFiles,
  getElectron,
  joinPath,
  LAST_FILE_KEY,
  splitPath,
  WORKSPACE_KEY,
} from "./useFileSystemHelpers";
import { useFileSystemFolderActions } from "./useFileSystemFolderActions";
import { useFileSystemEffects } from "./useFileSystemEffects";
import { useActiveFilePersistence } from "./useActiveFilePersistence";
import { invalidateApprovedSourceMutation } from "../services/approvalInvalidation";
import { buildAssetInventory } from "../services/mpforgeWorkbench";
import {
  appendMarkdownFileNameCounter,
  normalizeMarkdownFileName,
} from "../utils/fileName";
import {
  articlePaths,
  buildArticleDocument,
  isArticleStatus,
  parseArticleDocument,
  parseStateEvents,
  serializeArticleDocument,
  serializeStateEvents,
  transitionStatus,
  validateFrontmatter,
  validateStateEventChain,
  type ArticleStatus,
  type StateEvent,
} from "@mpforge/content-schema";
import {
  renderArticle as renderDeterministicArticle,
  sha256,
} from "@mpforge/renderer";
import {
  formatLintHtml,
  lintArticle,
  serializeLintReport,
  serializeLintSarif,
} from "@mpforge/linter";
import {
  createApprovalRecord,
  createInvalidationRecord,
  verifyApprovalChain,
  verifyInvalidationChain,
  type ApprovalRecord,
  type ApprovalInvalidationRecord,
  type ReviewChecklist,
  type ReviewEvidence,
} from "@mpforge/review-gate";

interface UseFileSystemOptions {
  enableEffects?: boolean;
}

export function useFileSystem(options: UseFileSystemOptions = {}) {
  const { enableEffects = false } = options;
  const {
    adapter,
    ready: storageReady,
    type: storageType,
  } = useStorageContext();
  const electron = getElectron();
  const {
    workspacePath,
    workspaceRevision,
    files,
    currentFile,
    isLoading,
    isSaving,
    lastSavedContent,
    isDirty,
    isRestoring,
    setWorkspacePath,
    bumpWorkspaceRevision,
    setFiles,
    setCurrentFile,
    setLoading,
    setSaving,
    setLastSavedContent,
    setLastSavedAt,
    setIsDirty,
    setIsRestoring,
  } = useFileStore();
  const { setMarkdown, markdown } = useEditorStore();
  const { themeId: theme, themeName } = useThemeStore();
  const isCreating = useRef<boolean>(false);
  const fileRefreshGenerationRef = useRef(0);

  const invalidateFileRefreshes = useCallback(() => {
    fileRefreshGenerationRef.current += 1;
  }, []);

  const resetActiveFile = useCallback(() => {
    setCurrentFile(null);
    setMarkdown("");
    setIsDirty(false);
    setLastSavedContent("");
    setLastSavedAt(null);
    try {
      window.localStorage?.removeItem?.(LAST_FILE_KEY);
    } catch {
      /* 浏览器禁用存储时不影响工作区切换 */
    }
  }, [
    setCurrentFile,
    setIsDirty,
    setLastSavedAt,
    setLastSavedContent,
    setMarkdown,
  ]);

  const resolveAvailableFilePath = useCallback(
    async (folderPath: string | undefined, fileName: string) => {
      if (!adapter || !storageReady) {
        return { fileName, filePath: joinPath(folderPath, fileName) };
      }

      let candidateName = fileName;
      let candidatePath = joinPath(folderPath, candidateName);
      let counter = 1;

      while (await adapter.exists(candidatePath)) {
        candidateName = appendMarkdownFileNameCounter(fileName, counter);
        candidatePath = joinPath(folderPath, candidateName);
        counter += 1;
      }

      return { fileName: candidateName, filePath: candidatePath };
    },
    [adapter, storageReady],
  );

  const refreshFiles = useCallback(
    async (dir?: string) => {
      const refreshGeneration = fileRefreshGenerationRef.current;
      if (electron) {
        const target = dir || workspacePath;
        if (!target) return;

        const res = await electron.fs.listFiles(target);
        if (
          refreshGeneration === fileRefreshGenerationRef.current &&
          res.success &&
          res.files
        ) {
          setFiles(convertToTreeItems(res.files));
        }
        return;
      }

      if (adapter && storageReady) {
        try {
          const rawFiles = await adapter.listFiles();
          if (refreshGeneration === fileRefreshGenerationRef.current) {
            setFiles(convertAdapterFilesToTreeItems(rawFiles));
          }
        } catch (error) {
          if (refreshGeneration !== fileRefreshGenerationRef.current) return;
          console.error("加载文件列表失败:", error);
          toast.error("无法加载文件列表");
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workspacePath, electron, adapter, storageReady],
  );

  const readWorkspaceTextFile = useCallback(
    async (filePath: string): Promise<string | null> => {
      if (electron) {
        const result = await electron.fs.readFile(filePath);
        return result.success && typeof result.content === "string"
          ? result.content
          : null;
      }
      if (adapter && storageReady) {
        try {
          return await adapter.readFile(filePath);
        } catch {
          return null;
        }
      }
      return null;
    },
    [adapter, electron, storageReady],
  );

  const loadWorkspace = useCallback(
    async (path: string) => {
      if (electron) {
        setLoading(true);
        invalidateFileRefreshes();
        try {
          const res = await electron.fs.setWorkspace(path);
          if (res.success) {
            resetActiveFile();
            setFiles([]);
            setWorkspacePath(path);
            bumpWorkspaceRevision();
            localStorage.setItem(WORKSPACE_KEY, path);
            await refreshFiles(path);
          } else {
            setWorkspacePath(null);
            localStorage.removeItem(WORKSPACE_KEY);
          }
        } catch (error) {
          console.error(error);
        } finally {
          setLoading(false);
        }
        return;
      }

      invalidateFileRefreshes();
      setWorkspacePath(path);
      bumpWorkspaceRevision();
      await refreshFiles();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [electron, invalidateFileRefreshes, resetActiveFile],
  );

  const openFile = useCallback(
    async (file: FileItem) => {
      setIsRestoring(true);

      const currentIsDirty = useFileStore.getState().isDirty;
      const activeFile = useFileStore.getState().currentFile;

      if (activeFile && currentIsDirty) {
        const { markdown: currentMarkdown } = useEditorStore.getState();
        const { themeId: currentTheme, themeName: currentThemeName } =
          useThemeStore.getState();
        const baseContent = useFileStore.getState().lastSavedContent;
        const fullContent = applyMarkdownFileMeta(baseContent, {
          body: currentMarkdown,
          theme: currentTheme,
          themeName: currentThemeName,
          title: activeFile.title || stripMarkdownExtension(activeFile.name),
        });

        if (electron) {
          try {
            const res = await electron.fs.saveFile({
              filePath: activeFile.path,
              content: fullContent,
              expectedContent: baseContent,
            });
            if (res.success) {
              setIsDirty(false);
              setLastSavedContent(fullContent);
              setLastSavedAt(new Date());
              await refreshFiles();
            } else {
              console.error("切换前保存失败:", res.error);
              toast.error(`切换已取消：${res.error || "当前文章保存失败"}`);
              setIsRestoring(false);
              return;
            }
          } catch (error) {
            console.error("切换前保存失败:", error);
            toast.error("切换已取消：当前文章保存失败");
            setIsRestoring(false);
            return;
          }
        } else if (adapter && storageReady) {
          try {
            const persisted = await adapter.readFile(activeFile.path);
            if (persisted !== baseContent && persisted !== fullContent) {
              toast.error("切换已取消：检测到外部文件修改");
              setIsRestoring(false);
              return;
            }
            await adapter.writeFile(activeFile.path, fullContent);
            setIsDirty(false);
            setLastSavedContent(fullContent);
            setLastSavedAt(new Date());
            await refreshFiles();
          } catch (error) {
            console.error("切换前保存失败:", error);
            toast.error("切换已取消：当前文章保存失败");
            setIsRestoring(false);
            return;
          }
        }
      }

      let content = "";
      let success = false;

      if (electron) {
        const res = await electron.fs.readFile(file.path);
        if (res.success && typeof res.content === "string") {
          content = res.content;
          success = true;
        }
      } else if (adapter && storageReady) {
        try {
          content = await adapter.readFile(file.path);
          success = true;
        } catch (error) {
          console.error("读取文件错误:", error);
        }
      }

      if (success) {
        const parsed = parseMarkdownFileContent(content);
        const resolvedTitle =
          parsed.title?.trim() ||
          file.title?.trim() ||
          stripMarkdownExtension(file.name);

        setCurrentFile({ ...file, title: resolvedTitle });
        setMarkdown(parsed.body);
        useThemeStore.getState().selectTheme(parsed.theme);
        setLastSavedContent(content);
        setIsDirty(false);
      } else {
        toast.error("无法读取文件");
      }

      setTimeout(() => {
        setIsRestoring(false);
      }, 100);

      localStorage.setItem(LAST_FILE_KEY, file.path);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setMarkdown, electron, adapter, storageReady, refreshFiles],
  );

  const createFile = useCallback(
    async (folderPath?: string) => {
      if (isCreating.current) return;
      isCreating.current = true;

      const initialTitle = "新文章";
      const themeState = useThemeStore.getState();
      const targetTheme = resolveNewArticleThemeSnapshot(
        themeState,
        themeState.getAllThemes(),
      );
      const initialContent = buildMarkdownFileContent({
        body: "# 新文章\n\n",
        theme: targetTheme.themeId,
        themeName: targetTheme.themeName,
        title: initialTitle,
      });

      try {
        const filename = normalizeMarkdownFileName(initialTitle);
        const targetPath = joinPath(folderPath, filename);

        if (electron) {
          if (!workspacePath) return;
          const res = await electron.fs.createFile({
            filename: targetPath,
            content: initialContent,
          });
          if (res.success && res.filePath) {
            await refreshFiles();
            const newFile = {
              name: res.filename!,
              path: res.filePath!,
              createdAt: new Date(),
              updatedAt: new Date(),
              size: 0,
              title: initialTitle,
              themeName: targetTheme.themeName,
            };
            await openFile(newFile);
            toast.success("已创建新文章");
          }
          return;
        }

        if (adapter && storageReady) {
          const available = await resolveAvailableFilePath(
            folderPath,
            filename,
          );
          await adapter.writeFile(available.filePath, initialContent);
          await refreshFiles();
          const newFile = {
            name: available.fileName,
            path: available.filePath,
            createdAt: new Date(),
            updatedAt: new Date(),
            size: initialContent.length,
            title: initialTitle,
            themeName: targetTheme.themeName,
          };
          await openFile(newFile);
          toast.success("已创建新文章");
        }
      } catch {
        toast.error("创建失败");
      } finally {
        isCreating.current = false;
      }
    },
    [
      workspacePath,
      refreshFiles,
      openFile,
      electron,
      adapter,
      storageReady,
      resolveAvailableFilePath,
    ],
  );

  const persistActiveFile = useActiveFilePersistence({
    adapter,
    electron,
    storageReady,
    setIsDirty,
    setLastSavedAt,
    setLastSavedContent,
    setSaving,
  });

  const saveFile = useCallback(
    async (showToast = false) => {
      await persistActiveFile(showToast);
    },
    [persistActiveFile],
  );

  const updateCurrentArticleSource = useCallback(
    async (source: string): Promise<boolean> => {
      const activeFile = useFileStore.getState().currentFile;
      const expectedSource = useFileStore.getState().lastSavedContent;
      if (!activeFile) {
        toast.error("请先打开一篇 Content-as-Code 文章");
        return false;
      }

      let document: ReturnType<typeof parseArticleDocument>;
      try {
        document = parseArticleDocument(source);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Frontmatter 解析失败",
        );
        return false;
      }
      const validation = validateFrontmatter(document.frontmatter);
      if (!validation.valid) {
        toast.error(`Frontmatter 校验失败：${validation.errors[0]}`);
        return false;
      }
      const persistedDocument = parseArticleDocument(expectedSource);
      for (const immutable of ["id", "slug", "status"] as const) {
        if (
          document.frontmatter[immutable] !==
          persistedDocument.frontmatter[immutable]
        ) {
          toast.error(`${immutable} 不能在 Frontmatter 表单中直接修改`);
          return false;
        }
      }
      const persistedVersion =
        typeof persistedDocument.frontmatter.version === "number"
          ? persistedDocument.frontmatter.version
          : 0;
      const normalizedSource = serializeArticleDocument({
        ...document,
        frontmatter: {
          ...document.frontmatter,
          created_at: persistedDocument.frontmatter.created_at,
          updated_at: new Date().toISOString(),
          version: persistedVersion + 1,
        },
      });

      setSaving(true);
      try {
        let current = expectedSource;
        if (electron) {
          const result = await electron.fs.readFile(activeFile.path);
          if (result.success && typeof result.content === "string") {
            current = result.content;
          }
        } else if (adapter && storageReady) {
          try {
            current = await adapter.readFile(activeFile.path);
          } catch {
            // The active buffer remains authoritative when the backing file was
            // just created but the adapter has not refreshed yet.
          }
        } else {
          throw new Error("存储尚未就绪");
        }
        if (current !== expectedSource && current !== normalizedSource) {
          toast.error(
            "检测到外部文件修改，已保留当前编辑内容，请重新载入后合并",
          );
          return false;
        }
        const prepared = await invalidateApprovedSourceMutation({
          articlePath: activeFile.path,
          previousSource: expectedSource,
          proposedSource: normalizedSource,
          store: {
            read: readWorkspaceTextFile,
            write: async (filePath, content, expectedContent) => {
              if (electron) {
                const result = await electron.fs.saveFile({
                  filePath,
                  content,
                  expectedContent,
                });
                if (!result.success) {
                  throw new Error(
                    result.error || "APPROVAL_INVALIDATION_WRITE_FAILED",
                  );
                }
                return;
              }
              if (adapter && storageReady) {
                await adapter.writeFile(filePath, content);
                return;
              }
              throw new Error("存储尚未就绪");
            },
          },
        });
        const sourceToWrite = prepared.content;
        if (electron) {
          const saved = await electron.fs.saveFile({
            filePath: activeFile.path,
            content: sourceToWrite,
            expectedContent: expectedSource,
          });
          if (!saved.success) throw new Error(saved.error || "保存失败");
        } else if (adapter && storageReady) {
          await adapter.writeFile(activeFile.path, sourceToWrite);
        }

        const savedDocument = parseArticleDocument(sourceToWrite);
        const title =
          typeof savedDocument.frontmatter.title === "string"
            ? savedDocument.frontmatter.title
            : activeFile.title;
        const selectedArticleTheme = savedDocument.frontmatter.theme;
        if (typeof selectedArticleTheme === "string") {
          useThemeStore.getState().selectTheme(selectedArticleTheme);
        }
        setCurrentFile({
          ...activeFile,
          title,
          status:
            typeof savedDocument.frontmatter.status === "string"
              ? savedDocument.frontmatter.status
              : activeFile.status,
        });
        setMarkdown(savedDocument.body);
        setLastSavedContent(sourceToWrite);
        setLastSavedAt(new Date());
        setIsDirty(false);
        if (prepared.invalidated) {
          window.dispatchEvent(
            new CustomEvent("mpforge:approval-invalidated", {
              detail: prepared.invalidationRecord,
            }),
          );
        }
        await refreshFiles();
        return true;
      } catch (error) {
        console.error("Frontmatter 保存失败", error);
        toast.error(error instanceof Error ? error.message : "保存失败");
        return false;
      } finally {
        setSaving(false);
      }
    },
    [
      adapter,
      electron,
      refreshFiles,
      readWorkspaceTextFile,
      setCurrentFile,
      setIsDirty,
      setLastSavedAt,
      setLastSavedContent,
      setMarkdown,
      setSaving,
      storageReady,
    ],
  );

  const buildCurrentArticle = useCallback(async (): Promise<boolean> => {
    const activeFile = useFileStore.getState().currentFile;
    if (!activeFile) {
      toast.error("请先打开一篇 Content-as-Code 文章");
      return false;
    }
    if (!(await persistActiveFile(false, true))) return false;

    const source = useFileStore.getState().lastSavedContent;
    let document: ReturnType<typeof parseArticleDocument>;
    try {
      document = parseArticleDocument(source);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Frontmatter 解析失败",
      );
      return false;
    }
    const validation = validateFrontmatter(document.frontmatter);
    if (!validation.valid) {
      toast.error(`构建被 Schema 阻止：${validation.errors[0]}`);
      return false;
    }

    const themeId =
      typeof document.frontmatter.theme === "string"
        ? document.frontmatter.theme
        : "minimal";
    const result = renderDeterministicArticle({
      markdown: document.body,
      themeId,
      colorScheme: "light",
    });
    const repeated = renderDeterministicArticle({
      markdown: document.body,
      themeId,
      colorScheme: "light",
    });
    if (
      result.documentHtml !== repeated.documentHtml ||
      result.renderedHtmlHash !== repeated.renderedHtmlHash
    ) {
      toast.error("构建被确定性检查阻止");
      return false;
    }

    const articleDirectory = splitPath(activeFile.path).dir;
    const buildDirectory = joinPath(articleDirectory, "build");
    const htmlPath = joinPath(buildDirectory, "article.html");
    const rawHtmlPath = joinPath(buildDirectory, "article.raw.html");
    const safeHtmlPath = joinPath(buildDirectory, "article.safe.html");
    const wechatHtmlPath = joinPath(buildDirectory, "article.wechat.html");
    const lintJsonPath = joinPath(buildDirectory, "lint-report.json");
    const lintHtmlPath = joinPath(buildDirectory, "lint-report.html");
    const lintSarifPath = joinPath(buildDirectory, "lint-report.sarif");
    const metadataPath = joinPath(buildDirectory, "article.meta.json");
    const assetsDirectory = joinPath(articleDirectory, "assets");
    const assetsManifestPath = joinPath(assetsDirectory, "manifest.json");
    const existingManifest = await readWorkspaceTextFile(assetsManifestPath);
    const assetInventory = buildAssetInventory(
      activeFile.path,
      document.body,
      flattenFiles(useFileStore.getState().files),
      existingManifest ?? undefined,
    );
    const sourceHash = sha256(
      source.replace(
        /^(status|human_reviewed|updated_at|version):[^\r\n]*$/gm,
        "$1: <workflow-managed>",
      ),
    );
    const lint = lintArticle({
      articlePath: activeFile.path.replace(/\\/g, "/"),
      articleId: String(document.frontmatter.id),
      articleSlug: String(document.frontmatter.slug),
      frontmatter: document.frontmatter,
      markdown: document.body,
      renderedHtml: result.rawHtml,
      safeHtml: result.safeHtml,
      wechatHtml: result.wechatHtml,
      renderedCss: result.css,
      assets: assetInventory,
      determinism: {
        firstHtmlHash: result.renderedHtmlHash,
        secondHtmlHash: repeated.renderedHtmlHash,
      },
      sourceHash,
      renderedHtmlHash: result.renderedHtmlHash,
      generatedAt:
        typeof document.frontmatter.updated_at === "string"
          ? document.frontmatter.updated_at
          : "1970-01-01T00:00:00.000Z",
    });
    const metadata = {
      schema: "mpforge.build/v2",
      article_id: String(document.frontmatter.id),
      source_hash: sourceHash,
      rendered_html_hash: result.renderedHtmlHash,
      wechat_html_hash: result.wechatHtmlHash,
      theme_id: result.themeId,
      theme_version: result.themeVersion,
      theme_hash: result.themeHash,
      renderer_version: result.rendererVersion,
      build_settings_hash: sha256("mpforge-build/v2:raw,safe,wechat"),
      generated_at: new Date().toISOString(),
      source_commit: "working-tree",
      warnings: [...validation.warnings, ...result.warnings],
    };
    const hasImageReferences = /!\[[^\]]*\]\(([^)]+)\)/.test(document.body);
    const emptyManifest = {
      schema_version: "1",
      article_id: String(document.frontmatter.id),
      generated_at: metadata.generated_at,
      assets: [],
    };
    try {
      if (electron) {
        const buildFolder = await electron.fs.createFolder(buildDirectory);
        if (!buildFolder.success) {
          throw new Error(buildFolder.error || "无法创建 build 目录");
        }
        if (!existingManifest && !hasImageReferences) {
          const assetsFolder = await electron.fs.createFolder(assetsDirectory);
          if (!assetsFolder.success) {
            throw new Error(assetsFolder.error || "无法创建 assets 目录");
          }
        }
        const htmlSaved = await electron.fs.saveFile({
          filePath: htmlPath,
          content: result.documentHtml,
        });
        if (!htmlSaved.success)
          throw new Error(htmlSaved.error || "HTML 写入失败");
        for (const [filePath, content] of [
          [rawHtmlPath, result.rawDocumentHtml],
          [safeHtmlPath, result.safeDocumentHtml],
          [wechatHtmlPath, result.wechatDocumentHtml],
          [lintJsonPath, serializeLintReport(lint)],
          [lintHtmlPath, formatLintHtml(lint)],
          [lintSarifPath, serializeLintSarif(lint)],
          [metadataPath, `${JSON.stringify(metadata, null, 2)}\n`],
          ...(!existingManifest && !hasImageReferences
            ? ([
                [
                  assetsManifestPath,
                  `${JSON.stringify(emptyManifest, null, 2)}\n`,
                ],
              ] as const)
            : []),
        ] as const) {
          const saved = await electron.fs.saveFile({ filePath, content });
          if (!saved.success)
            throw new Error(saved.error || `写入失败：${filePath}`);
        }
      } else if (adapter && storageReady) {
        if (adapter.createFolder) {
          const buildFolder = await adapter.createFolder(buildDirectory);
          if (!buildFolder.success && buildFolder.error !== "文件夹已存在") {
            throw new Error(buildFolder.error || "无法创建 build 目录");
          }
        }
        if (!existingManifest && !hasImageReferences && adapter.createFolder) {
          const assetsFolder = await adapter.createFolder(assetsDirectory);
          if (!assetsFolder.success && assetsFolder.error !== "文件夹已存在") {
            throw new Error(assetsFolder.error || "无法创建 assets 目录");
          }
        }
        await adapter.writeFile(htmlPath, result.documentHtml);
        await Promise.all([
          adapter.writeFile(rawHtmlPath, result.rawDocumentHtml),
          adapter.writeFile(safeHtmlPath, result.safeDocumentHtml),
          adapter.writeFile(wechatHtmlPath, result.wechatDocumentHtml),
          adapter.writeFile(lintJsonPath, serializeLintReport(lint)),
          adapter.writeFile(lintHtmlPath, formatLintHtml(lint)),
          adapter.writeFile(lintSarifPath, serializeLintSarif(lint)),
          adapter.writeFile(
            metadataPath,
            `${JSON.stringify(metadata, null, 2)}\n`,
          ),
          ...(!existingManifest && !hasImageReferences
            ? [
                adapter.writeFile(
                  assetsManifestPath,
                  `${JSON.stringify(emptyManifest, null, 2)}\n`,
                ),
              ]
            : []),
        ]);
      } else {
        throw new Error("存储尚未就绪");
      }
      await refreshFiles();
      toast.success("确定性 HTML 与构建元数据已保存");
      return true;
    } catch (error) {
      console.error("构建产物保存失败", error);
      toast.error(error instanceof Error ? error.message : "构建产物保存失败");
      return false;
    }
  }, [
    adapter,
    electron,
    persistActiveFile,
    readWorkspaceTextFile,
    refreshFiles,
    storageReady,
  ]);

  const selectWorkspace = useCallback(async () => {
    if (electron) {
      setLoading(true);
      try {
        if (!(await persistActiveFile(false, true))) return;

        const res = await electron.fs.selectWorkspace();
        if (res.success && res.path) {
          await loadWorkspace(res.path);
        }
      } finally {
        setLoading(false);
      }
      return;
    }

    if (storageType === "filesystem" && adapter?.selectWorkspace) {
      const selection = adapter.selectWorkspace({
        beforeCommit: async () => {
          const saved = await persistActiveFile(false, true);
          if (saved) invalidateFileRefreshes();
          return saved;
        },
      });
      setLoading(true);
      try {
        const result = await selection;
        if (result.success) {
          resetActiveFile();
          setFiles([]);
          setWorkspacePath(result.workspaceName || "本地文件夹");
          bumpWorkspaceRevision();
          await refreshFiles();
        } else if (!result.canceled) {
          toast.error(result.error || "无法切换工作区");
        }
      } finally {
        setLoading(false);
      }
      return;
    }

    toast('请在右上角"存储模式"中切换文件夹', { icon: "ℹ️" });
  }, [
    adapter,
    bumpWorkspaceRevision,
    electron,
    invalidateFileRefreshes,
    loadWorkspace,
    persistActiveFile,
    refreshFiles,
    resetActiveFile,
    setFiles,
    setLoading,
    setWorkspacePath,
    storageType,
  ]);

  const updateFileTitle = useCallback(
    async (file: FileItem, newName: string) => {
      const nextTitle = newName.trim();
      if (!nextTitle) {
        toast.error("标题不能为空");
        return;
      }

      let content = "";
      if (electron) {
        const readRes = await electron.fs.readFile(file.path);
        if (!readRes.success || typeof readRes.content !== "string") {
          toast.error(readRes.error || "读取文件失败");
          return;
        }
        content = readRes.content;
      } else if (adapter && storageReady) {
        try {
          content = await adapter.readFile(file.path);
        } catch {
          toast.error("读取文件失败");
          return;
        }
      } else {
        toast.error("当前模式不支持此操作");
        return;
      }

      const parsed = parseMarkdownFileContent(content);
      const fullContent = applyMarkdownFileMeta(content, {
        body: parsed.body,
        theme: parsed.theme,
        themeName: parsed.themeName,
        title: nextTitle,
      });
      const targetFileName = normalizeMarkdownFileName(nextTitle);
      const { dir } = splitPath(file.path);
      const targetPath = joinPath(dir, targetFileName);

      let success = false;
      let errorMsg = "";
      let nextPath = file.path;
      let nextName = file.name;
      if (electron) {
        if (targetPath !== file.path) {
          const renameRes = await electron.fs.renameFile({
            oldPath: file.path,
            newName: targetFileName,
          });
          success = renameRes.success;
          errorMsg = renameRes.error || "";
          if (renameRes.success) {
            nextPath = renameRes.filePath || targetPath;
            nextName = targetFileName;
          }
        }
        if (success || targetPath === file.path) {
          const saveRes = await electron.fs.saveFile({
            filePath: nextPath,
            content: fullContent,
          });
          success = saveRes.success;
          errorMsg = saveRes.error || "";
        }
      } else if (adapter && storageReady) {
        try {
          if (targetPath !== file.path) {
            if (await adapter.exists(targetPath)) {
              throw new Error("文件名已存在");
            }
            await adapter.renameFile(file.path, targetPath);
            nextPath = targetPath;
            nextName = targetFileName;
          }
          await adapter.writeFile(nextPath, fullContent);
          success = true;
        } catch (error: unknown) {
          errorMsg = error instanceof Error ? error.message : String(error);
        }
      }

      if (!success) {
        toast.error(errorMsg || "重命名失败");
        return;
      }

      if (currentFile && currentFile.path === file.path) {
        setCurrentFile({
          ...currentFile,
          name: nextName,
          path: nextPath,
          title: nextTitle,
        });
        localStorage.setItem(LAST_FILE_KEY, nextPath);
        const currentState = useFileStore.getState();
        if (!currentState.isDirty) {
          setLastSavedContent(fullContent);
        }
      }

      toast.success("已重命名");
      await refreshFiles();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refreshFiles, currentFile, electron, adapter, storageReady],
  );

  const deleteFile = useCallback(
    async (file: FileItem) => {
      let success = false;

      if (electron) {
        const res = await electron.fs.deleteFile(file.path);
        success = res.success;
      } else if (adapter && storageReady) {
        try {
          await adapter.deleteFile(file.path);
          success = true;
        } catch (error) {
          console.error(error);
        }
      }

      if (success) {
        toast.success("已删除");
        await refreshFiles();
        if (currentFile && currentFile.path === file.path) {
          setCurrentFile(null);
          setMarkdown("");
          setIsDirty(false);
          setLastSavedContent("");
        }
      } else {
        toast.error("删除失败");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refreshFiles, currentFile, setMarkdown, electron, adapter, storageReady],
  );

  const folderActions = useFileSystemFolderActions({
    electron,
    adapter,
    refreshFiles,
    currentFile,
    setCurrentFile,
    setMarkdown,
    setIsDirty,
    setLastSavedContent,
  });

  const createContentArticle = useCallback(
    async (requestedSlug?: string) => {
      if (!electron && (!adapter || !storageReady)) {
        toast.error("请先选择本地工作区");
        return null;
      }
      if (electron && !workspacePath) {
        toast.error("请先选择本地工作区");
        return null;
      }

      const now = new Date();
      const timestamp = now
        .toISOString()
        .replace(/[-:TZ.]/g, "")
        .slice(0, 14);
      const slug = requestedSlug?.trim() || `article-${timestamp}`;
      let paths: ReturnType<typeof articlePaths>;
      try {
        paths = articlePaths(slug);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "文章 slug 无效");
        return null;
      }

      const articleId =
        globalThis.crypto?.randomUUID?.() ?? `article-${timestamp}`;
      const createdAt = now.toISOString();
      const articleContent = buildArticleDocument(
        {
          id: articleId,
          slug,
          title: "新文章",
          summary: "",
          author: "",
          account: "",
          theme: "minimal",
          status: "idea",
          cover: null,
          source_url: null,
          original: true,
          ai_assisted: false,
          ai_tasks: [],
          human_reviewed: false,
          need_open_comment: true,
          only_fans_can_comment: false,
          created_at: createdAt,
          updated_at: createdAt,
          version: 1,
        },
        "# 新文章\n\n",
      );
      const folders = [
        paths.assets,
        paths.build,
        paths.receipts,
        paths.history,
      ];

      try {
        if (electron) {
          const existingArticle = await electron.fs.readFile(
            joinPath(workspacePath || "", paths.article),
          );
          if (existingArticle.success) {
            throw new Error(`文章已存在：content/${slug}/article.md`);
          }
          for (const folder of folders) {
            const result = await electron.fs.createFolder(folder);
            if (!result.success) {
              throw new Error(result.error || `无法创建目录 ${folder}`);
            }
          }
          const created = await electron.fs.createFile({
            filename: paths.article,
            content: articleContent,
          });
          if (!created.success || !created.filePath || !created.filename) {
            throw new Error("无法创建 article.md");
          }
          const historyCreated = await electron.fs.createFile({
            filename: paths.stateEvents,
            content: "",
          });
          if (!historyCreated.success) {
            throw new Error("无法创建 history/state-events.jsonl");
          }
          await refreshFiles();
          const file: FileItem = {
            name: created.filename,
            path: created.filePath,
            createdAt: now,
            updatedAt: now,
            size: articleContent.length,
            title: "新文章",
            themeName: "minimal",
          };
          await openFile(file);
          toast.success(`已创建 content/${slug}/article.md`);
          return file;
        }

        if (await adapter!.exists(paths.article)) {
          throw new Error(`文章已存在：content/${slug}/article.md`);
        }
        if (adapter!.createFolder) {
          for (const folder of folders) {
            const result = await adapter!.createFolder(folder);
            if (!result.success) {
              throw new Error(result.error || `无法创建目录 ${folder}`);
            }
          }
        }
        await adapter!.writeFile(paths.article, articleContent);
        await adapter!.writeFile(paths.stateEvents, "");
        await refreshFiles();
        const file: FileItem = {
          name: "article.md",
          path: paths.article,
          createdAt: now,
          updatedAt: now,
          size: articleContent.length,
          title: "新文章",
          themeName: "minimal",
        };
        await openFile(file);
        toast.success(`已创建 content/${slug}/article.md`);
        return file;
      } catch (error) {
        console.error("创建 Content-as-Code 文章失败", error);
        toast.error(error instanceof Error ? error.message : "创建文章失败");
        return null;
      }
    },
    [adapter, electron, openFile, refreshFiles, storageReady, workspacePath],
  );

  const transitionCurrentArticle = useCallback(
    async (
      target: ArticleStatus,
      options: {
        explicitHumanAction?: boolean;
        actorId?: string;
        reason?: string;
        lintErrors?: number;
        previewComplete?: boolean;
      } = {},
    ) => {
      const activeFile = useFileStore.getState().currentFile;
      if (!activeFile) {
        toast.error("请先打开一篇 Content-as-Code 文章");
        return false;
      }
      if (target === "approved") {
        if (options.explicitHumanAction !== true) {
          toast.error("批准必须由本地用户执行显式人工动作");
          return false;
        }
        if (options.lintErrors !== 0 || !options.previewComplete) {
          toast.error("批准被质量门阻止：需要零 ERROR 和完整深浅色预览");
          return false;
        }
      }
      if (!(await persistActiveFile(false, true))) return false;

      const source = useFileStore.getState().lastSavedContent;
      let document: ReturnType<typeof parseArticleDocument>;
      try {
        document = parseArticleDocument(source);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Frontmatter 解析失败",
        );
        return false;
      }
      const currentStatus = document.frontmatter.status;
      if (!isArticleStatus(currentStatus)) {
        toast.error("文章状态无效");
        return false;
      }
      const transition = transitionStatus(currentStatus, target, {
        actor: { kind: "human", id: options.actorId || "local-ui-user" },
        explicitHumanAction: options.explicitHumanAction,
        reason:
          options.reason ||
          `Explicit local UI transition from ${currentStatus} to ${target}`,
      });
      if (!transition.ok || !transition.auditEvent) {
        toast.error(`不允许从 ${currentStatus} 跳转到 ${target}`);
        return false;
      }

      const now = new Date().toISOString();
      const nextSource = serializeArticleDocument({
        ...document,
        frontmatter: {
          ...document.frontmatter,
          status: target,
          human_reviewed: target === "reviewed" || target === "approved",
          updated_at: now,
          version:
            typeof document.frontmatter.version === "number"
              ? document.frontmatter.version + 1
              : 1,
        },
      });
      const articleDirectory = splitPath(activeFile.path).dir;
      const historyDirectory = joinPath(articleDirectory, "history");
      const stateEventsPath = joinPath(historyDirectory, "state-events.jsonl");

      try {
        let historyRaw = "";
        if (electron) {
          const folder = await electron.fs.createFolder(historyDirectory);
          if (!folder.success) {
            throw new Error(folder.error || "无法创建 history 目录");
          }
          const read = await electron.fs.readFile(stateEventsPath);
          if (read.success && typeof read.content === "string") {
            historyRaw = read.content;
          }
        } else if (adapter && storageReady) {
          if (adapter.createFolder) {
            const folder = await adapter.createFolder(historyDirectory);
            if (!folder.success && folder.error !== "文件夹已存在") {
              throw new Error(folder.error || "无法创建 history 目录");
            }
          }
          try {
            historyRaw = await adapter.readFile(stateEventsPath);
          } catch {
            historyRaw = "";
          }
        } else {
          throw new Error("存储尚未就绪");
        }

        const parsedEvents = parseStateEvents(historyRaw);
        const chain = validateStateEventChain(parsedEvents.events);
        if (
          parsedEvents.errors.length > 0 ||
          !chain.valid ||
          chain.status !== currentStatus
        ) {
          throw new Error(
            `状态历史无效：${[
              ...parsedEvents.errors,
              ...chain.errors,
              ...(chain.status !== currentStatus
                ? [`history=${chain.status}, article=${currentStatus}`]
                : []),
            ].join("；")}`,
          );
        }

        const event: StateEvent = {
          event_id: transition.auditEvent.id,
          article_id: String(document.frontmatter.id),
          from_status: currentStatus,
          to_status: target,
          actor_type: "human",
          actor_id: options.actorId || "local-ui-user",
          reason:
            options.reason ||
            `Explicit local UI transition from ${currentStatus} to ${target}`,
          created_at: now,
          source_commit: "working-tree",
        };
        const nextHistory = serializeStateEvents([
          ...parsedEvents.events,
          event,
        ]);

        if (electron) {
          const articleSaved = await electron.fs.saveFile({
            filePath: activeFile.path,
            content: nextSource,
            expectedContent: source,
          });
          if (!articleSaved.success) {
            throw new Error(articleSaved.error || "文章状态保存失败");
          }
          const historySaved = await electron.fs.saveFile({
            filePath: stateEventsPath,
            content: nextHistory,
            expectedContent: historyRaw,
          });
          if (!historySaved.success) {
            throw new Error(historySaved.error || "状态历史保存失败");
          }
        } else if (adapter && storageReady) {
          const currentSource = await adapter.readFile(activeFile.path);
          if (currentSource !== source) {
            throw new Error("检测到外部修改；状态变化未覆盖磁盘内容");
          }
          await adapter.writeFile(activeFile.path, nextSource);
          await adapter.writeFile(stateEventsPath, nextHistory);
        }

        setCurrentFile({ ...activeFile, status: target });
        setLastSavedContent(nextSource);
        setLastSavedAt(new Date());
        setIsDirty(false);
        await refreshFiles();
        toast.success(`状态已更新：${currentStatus} → ${target}`);
        return true;
      } catch (error) {
        console.error("保存状态变化失败", error);
        toast.error(error instanceof Error ? error.message : "状态变化失败");
        return false;
      }
    },
    [
      adapter,
      electron,
      persistActiveFile,
      refreshFiles,
      setCurrentFile,
      setIsDirty,
      setLastSavedAt,
      setLastSavedContent,
      storageReady,
    ],
  );

  const approveCurrentArticle = useCallback(
    async (input: {
      lintErrors: number;
      previewComplete: boolean;
      reviewerId: string;
      confirmedSourceHash: string;
      checklist: ReviewChecklist;
      warningsAcknowledged: string[];
    }) => {
      const activeFile = useFileStore.getState().currentFile;
      if (!activeFile || !input.reviewerId.trim()) {
        toast.error("批准需要明确的人工审核人身份");
        return false;
      }
      if (!(await persistActiveFile(false, true))) return false;
      const source = useFileStore.getState().lastSavedContent;
      const document = parseArticleDocument(source);
      const articleDirectory = splitPath(activeFile.path).dir;
      const buildDirectory = joinPath(articleDirectory, "build");
      const historyDirectory = joinPath(articleDirectory, "history");
      const approvalsPath = joinPath(historyDirectory, "approvals.jsonl");
      const readOptional = async (filePath: string): Promise<string> => {
        if (electron) {
          const result = await electron.fs.readFile(filePath);
          return result.success && typeof result.content === "string"
            ? result.content
            : "";
        }
        if (adapter && storageReady) {
          try {
            return await adapter.readFile(filePath);
          } catch {
            return "";
          }
        }
        throw new Error("存储尚未就绪");
      };
      const writeExact = async (
        filePath: string,
        content: string,
        previous: string,
      ) => {
        if (electron) {
          const result = await electron.fs.saveFile({
            filePath,
            content,
            expectedContent: previous,
          });
          if (!result.success)
            throw new Error(result.error || "审批记录写入失败");
          return;
        }
        if (adapter && storageReady) {
          await adapter.writeFile(filePath, content);
          return;
        }
        throw new Error("存储尚未就绪");
      };
      const paths = {
        raw: joinPath(buildDirectory, "article.raw.html"),
        safe: joinPath(buildDirectory, "article.safe.html"),
        wechat: joinPath(buildDirectory, "article.wechat.html"),
        meta: joinPath(buildDirectory, "article.meta.json"),
        lint: joinPath(buildDirectory, "lint-report.json"),
        preview: joinPath(buildDirectory, "preview-report.json"),
        manifest: joinPath(articleDirectory, "assets/manifest.json"),
      };
      try {
        const [
          rawHtml,
          safeHtml,
          wechatHtml,
          metaRaw,
          lintRaw,
          previewRaw,
          manifestRaw,
          previousApprovals,
        ] = await Promise.all([
          readOptional(paths.raw),
          readOptional(paths.safe),
          readOptional(paths.wechat),
          readOptional(paths.meta),
          readOptional(paths.lint),
          readOptional(paths.preview),
          readOptional(paths.manifest),
          readOptional(approvalsPath),
        ]);
        const meta = JSON.parse(metaRaw || "{}") as Record<string, unknown>;
        const lint = JSON.parse(lintRaw || "{}") as {
          error_count?: number;
          source_hash?: string;
          rendered_html_hash?: string;
          linter_version?: string;
          ruleset_version?: string;
        };
        const preview = JSON.parse(previewRaw || "{}") as {
          source_hash?: string;
          rendered_html_hash?: string;
          stage_hashes?: { wechat?: string };
        };
        const manifest = JSON.parse(manifestRaw || "{}") as {
          assets?: Array<{ asset_id?: string; rights_status?: string }>;
        };
        const sourceHash = sha256(
          source.replace(
            /^(status|human_reviewed|updated_at|version):[^\r\n]*$/gm,
            "$1: <workflow-managed>",
          ),
        );
        const evidence: ReviewEvidence = {
          articleId: String(document.frontmatter.id),
          status: document.frontmatter.status as ReviewEvidence["status"],
          sourceHash,
          renderedHtmlHash: String(meta.rendered_html_hash ?? ""),
          wechatHtmlHash: String(meta.wechat_html_hash ?? ""),
          lintReportHash: lintRaw ? sha256(lintRaw) : "",
          assetsManifestHash: manifestRaw ? sha256(manifestRaw) : "",
          themeHash: String(meta.theme_hash ?? ""),
          rendererVersion: String(meta.renderer_version ?? ""),
          linterVersion: lint.linter_version ?? "",
          rulesetVersion: lint.ruleset_version ?? "",
          buildSettingsHash: String(meta.build_settings_hash ?? ""),
          publishSettingsHash: sha256(
            JSON.stringify({
              account: document.frontmatter.account ?? null,
              cover: document.frontmatter.cover ?? null,
              original: document.frontmatter.original ?? null,
            }),
          ),
          lintErrorCount: lint.error_count ?? Number.POSITIVE_INFINITY,
          assets: (manifest.assets ?? []).map((asset) => ({
            assetId: asset.asset_id ?? "invalid",
            rightsStatus: (asset.rights_status ?? "unknown") as
              | "approved"
              | "pending"
              | "blocked"
              | "unknown",
          })),
          artifacts: {
            rawHtml: Boolean(rawHtml),
            safeHtml: Boolean(safeHtml),
            wechatHtml: Boolean(wechatHtml),
            lintReport: Boolean(lintRaw),
            assetsManifest: Boolean(manifestRaw),
            previewReport: Boolean(previewRaw),
          },
          buildSourceHash: String(meta.source_hash ?? ""),
          lintSourceHash: lint.source_hash ?? "",
          lintRenderedHtmlHash: lint.rendered_html_hash ?? "",
          previewSourceHash: preview.source_hash ?? "",
          previewRenderedHtmlHash: preview.rendered_html_hash ?? "",
          previewWechatHtmlHash: preview.stage_hashes?.wechat ?? "",
        };
        const approvals = previousApprovals
          .split(/\r?\n/)
          .filter(Boolean)
          .map((line) => JSON.parse(line) as ApprovalRecord);
        const chain = verifyApprovalChain(approvals);
        if (!chain.valid)
          throw new Error(`审批记录链无效：${chain.errors.join("；")}`);
        const record = createApprovalRecord(
          {
            evidence,
            checklist: input.checklist,
            actor: {
              actorType: "human",
              actorId: input.reviewerId.trim(),
              explicitHumanAction: true,
            },
            confirmedSourceHash: input.confirmedSourceHash,
            warningsAcknowledged: input.warningsAcknowledged,
            sourceCommit: "working-tree",
          },
          {
            approvalId: crypto.randomUUID(),
            approvedAt: new Date().toISOString(),
            previousRecordHash: approvals.at(-1)?.record_hash ?? null,
          },
        );
        const nextApprovals = `${previousApprovals && !previousApprovals.endsWith("\n") ? `${previousApprovals}\n` : previousApprovals}${JSON.stringify(record)}\n`;
        await writeExact(approvalsPath, nextApprovals, previousApprovals);
        const transitioned = await transitionCurrentArticle("approved", {
          explicitHumanAction: true,
          actorId: input.reviewerId.trim(),
          reason: `Bound approval ${record.approval_id}`,
          lintErrors: input.lintErrors,
          previewComplete: input.previewComplete,
        });
        if (!transitioned) {
          await writeExact(approvalsPath, previousApprovals, nextApprovals);
          return false;
        }
        window.dispatchEvent(
          new CustomEvent("mpforge:approval-recorded", { detail: record }),
        );
        toast.success(`审批记录已写入：${record.approval_id}`);
        return true;
      } catch (error) {
        console.error("审批质量门失败", error);
        toast.error(error instanceof Error ? error.message : "审批质量门失败");
        return false;
      }
    },
    [
      adapter,
      electron,
      persistActiveFile,
      storageReady,
      transitionCurrentArticle,
    ],
  );

  const revokeCurrentApproval = useCallback(
    async (reviewerId: string): Promise<boolean> => {
      const activeFile = useFileStore.getState().currentFile;
      if (!activeFile || !reviewerId.trim()) {
        toast.error("撤销批准需要明确的人工审核人身份");
        return false;
      }
      if (!(await persistActiveFile(false, true))) return false;
      const source = useFileStore.getState().lastSavedContent;
      const document = parseArticleDocument(source);
      if (document.frontmatter.status !== "approved") {
        toast.error("只有已批准文章可以撤销批准");
        return false;
      }
      const historyDirectory = joinPath(
        splitPath(activeFile.path).dir,
        "history",
      );
      const approvalsPath = joinPath(historyDirectory, "approvals.jsonl");
      const invalidationsPath = joinPath(
        historyDirectory,
        "approval-invalidations.jsonl",
      );
      const readOptional = async (filePath: string): Promise<string> => {
        const value = await readWorkspaceTextFile(filePath);
        return value ?? "";
      };
      const writeExact = async (
        filePath: string,
        content: string,
        previous: string,
      ) => {
        if (electron) {
          const result = await electron.fs.saveFile({
            filePath,
            content,
            expectedContent: previous,
          });
          if (!result.success)
            throw new Error(result.error || "批准失效记录写入失败");
          return;
        }
        if (adapter && storageReady) {
          await adapter.writeFile(filePath, content);
          return;
        }
        throw new Error("存储尚未就绪");
      };
      try {
        const [approvalRaw, invalidationRaw] = await Promise.all([
          readOptional(approvalsPath),
          readOptional(invalidationsPath),
        ]);
        const approvals = approvalRaw
          .split(/\r?\n/)
          .filter(Boolean)
          .map((line) => JSON.parse(line) as ApprovalRecord);
        const invalidations = invalidationRaw
          .split(/\r?\n/)
          .filter(Boolean)
          .map((line) => JSON.parse(line) as ApprovalInvalidationRecord);
        const approvalChain = verifyApprovalChain(approvals);
        const invalidationChain = verifyInvalidationChain(invalidations);
        if (!approvalChain.valid || !invalidationChain.valid) {
          throw new Error("审批或失效记录链无效，撤销已被阻止");
        }
        const invalidatedIds = new Set(
          invalidations.map((record) => record.previous_approval_id),
        );
        const approval = [...approvals]
          .reverse()
          .find((record) => !invalidatedIds.has(record.approval_id));
        if (!approval) throw new Error("没有可撤销的当前批准记录");
        const current: ReviewEvidence = {
          articleId: approval.article_id,
          status: "approved",
          sourceHash: approval.source_hash,
          renderedHtmlHash: approval.rendered_html_hash,
          wechatHtmlHash: approval.wechat_html_hash,
          lintReportHash: approval.lint_report_hash,
          assetsManifestHash: approval.assets_manifest_hash,
          themeHash: approval.theme_hash,
          rendererVersion: approval.renderer_version,
          linterVersion: approval.linter_version,
          rulesetVersion: approval.ruleset_version,
          buildSettingsHash: approval.build_settings_hash,
          publishSettingsHash: approval.publish_settings_hash,
          lintErrorCount: 0,
          assets: [],
          artifacts: {
            rawHtml: true,
            safeHtml: true,
            wechatHtml: true,
            lintReport: true,
            assetsManifest: true,
            previewReport: true,
          },
          buildSourceHash: approval.source_hash,
          lintSourceHash: approval.source_hash,
          lintRenderedHtmlHash: approval.rendered_html_hash,
          previewSourceHash: approval.source_hash,
          previewRenderedHtmlHash: approval.rendered_html_hash,
          previewWechatHtmlHash: approval.wechat_html_hash,
        };
        const record = createInvalidationRecord({
          approval,
          current,
          actor: {
            actorType: "human",
            actorId: reviewerId.trim(),
            explicitHumanAction: true,
          },
          invalidationId: crypto.randomUUID(),
          invalidatedAt: new Date().toISOString(),
          previousRecordHash: invalidations.at(-1)?.record_hash ?? null,
          forcedReason: "approval_revoked",
        });
        const nextInvalidations = `${
          invalidationRaw && !invalidationRaw.endsWith("\n")
            ? `${invalidationRaw}\n`
            : invalidationRaw
        }${JSON.stringify(record)}\n`;
        await writeExact(invalidationsPath, nextInvalidations, invalidationRaw);
        const transitioned = await transitionCurrentArticle("reviewed", {
          explicitHumanAction: true,
          actorId: reviewerId.trim(),
          reason: `Revoked approval ${approval.approval_id}`,
        });
        if (!transitioned) {
          await writeExact(
            invalidationsPath,
            invalidationRaw,
            nextInvalidations,
          );
          return false;
        }
        toast.success(`批准已撤销：${approval.approval_id}`);
        return true;
      } catch (error) {
        console.error("撤销批准失败", error);
        toast.error(error instanceof Error ? error.message : "撤销批准失败");
        return false;
      }
    },
    [
      adapter,
      electron,
      persistActiveFile,
      readWorkspaceTextFile,
      storageReady,
      transitionCurrentArticle,
    ],
  );

  const persistCurrentReceipt = useCallback(
    async (receiptId: string, receipt: Record<string, unknown>) => {
      if (
        !currentFile ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(receiptId)
      ) {
        return false;
      }
      const receiptPath = joinPath(
        joinPath(splitPath(currentFile.path).dir, "receipts"),
        `${receiptId}.json`,
      );
      const content = `${JSON.stringify(receipt, null, 2)}\n`;
      try {
        if (electron) {
          const result = await electron.fs.saveFile({
            filePath: receiptPath,
            content,
          });
          if (!result.success) throw new Error(result.error || "回执写入失败");
        } else if (adapter && storageReady) {
          await adapter.writeFile(receiptPath, content);
        } else {
          throw new Error("存储尚未就绪");
        }
        await refreshFiles();
        return true;
      } catch (error) {
        console.error("回执写入失败", error);
        toast.error(error instanceof Error ? error.message : "回执写入失败");
        return false;
      }
    },
    [adapter, currentFile, electron, refreshFiles, storageReady],
  );

  useFileSystemEffects({
    enabled: enableEffects,
    electron,
    adapter,
    storageReady,
    storageType,
    currentFile,
    markdown,
    theme,
    themeName,
    isRestoring,
    isDirty,
    lastSavedContent,
    isLoading,
    loadWorkspace,
    refreshFiles,
    openFile,
    createFile,
    saveFile,
    selectWorkspace,
    setCurrentFile,
    setMarkdown,
    setIsDirty,
    setLastSavedContent,
    setLoading,
    setWorkspacePath,
  });

  return {
    workspacePath,
    workspaceRevision,
    files,
    currentFile,
    isLoading,
    isSaving,
    selectWorkspace,
    refreshFiles,
    readWorkspaceTextFile,
    openFile,
    createFile,
    createContentArticle,
    updateCurrentArticleSource,
    buildCurrentArticle,
    transitionCurrentArticle,
    approveCurrentArticle,
    revokeCurrentApproval,
    persistCurrentReceipt,
    saveFile,
    updateFileTitle,
    renameFile: updateFileTitle,
    deleteFile,
    ...folderActions,
    flattenFiles,
  };
}
