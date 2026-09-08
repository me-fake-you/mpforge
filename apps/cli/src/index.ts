#!/usr/bin/env node
import {
  CliError,
  approveArticle,
  assetsImport,
  assetsList,
  assetsOptimize,
  assetsScan,
  assetsVerify,
  auditArticle,
  buildArticleArtifacts,
  createArticle,
  doctor,
  findWorkspaceRoot,
  initializeWorkspace,
  lintCommand,
  listArticles,
  makeLintReport,
  markArticleReviewed,
  preflightArticle,
  prepareArticleReview,
  previewArticle,
  readArticle,
  requestHumanReview,
  renderArticle,
  revokeArticleApproval,
  showArticle,
  transitionArticle,
  validateArticle,
} from "./cli.js";
import {
  doctorAccountConfiguration,
  listAccountConfigurations,
  showAccountConfiguration,
} from "./accounts.js";
import {
  cancelDraft,
  executeDraft,
  executeRealDraftInteractive,
  getDraftOperation,
  getDraftOperationReceipt,
  listDraftOperations,
  prepareDraft,
  reconcileDraft,
} from "./drafts.js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { capturePreviewImages } from "./preview.js";
import { sha256 } from "@mpforge/renderer";

export * from "./cli.js";
export * from "./preview.js";
export * from "./accounts.js";
export * from "./drafts.js";

async function persistRender(
  article: Awaited<ReturnType<typeof readArticle>>,
  result: Awaited<ReturnType<typeof renderArticle>>,
  mode: "light" | "dark",
) {
  await mkdir(path.join(article.articleDirectory, "build"), {
    recursive: true,
  });
  await writeFile(
    path.join(
      article.articleDirectory,
      "build",
      mode === "light" ? "article.html" : "article.dark.html",
    ),
    result.documentHtml ?? result.html,
    "utf8",
  );
  if (mode === "light") {
    const metadata = {
      article_id: String(article.frontmatter.id),
      source_hash: sha256(article.source),
      rendered_html_hash: result.renderedHtmlHash,
      theme_id: result.themeId,
      theme_version: result.themeVersion,
      theme_hash: result.themeHash,
      renderer_version: result.rendererVersion,
      generated_at: new Date().toISOString(),
      source_commit: process.env.MPFORGE_SOURCE_COMMIT || "working-tree",
      warnings: result.warnings,
    };
    await writeFile(
      path.join(article.articleDirectory, "build", "article.meta.json"),
      JSON.stringify(metadata, null, 2) + "\n",
      "utf8",
    );
  }
}

export async function runCommand(
  args: readonly string[],
  root = findWorkspaceRoot(),
  out: (text: string) => void = console.log,
): Promise<unknown> {
  const [command, ...rest] = args;
  switch (command) {
    case "init":
      await initializeWorkspace(root);
      out("Initialized MPForge workspace at " + root);
      return { root };
    case "new": {
      const article = await createArticle(rest[0] || "", root);
      out(article.articlePath);
      return article;
    }
    case "list": {
      const articles = await listArticles(root);
      out(JSON.stringify(articles, null, 2));
      return articles;
    }
    case "show": {
      const article = await showArticle(rest[0] || "", root);
      out(JSON.stringify(article, null, 2));
      return article;
    }
    case "validate": {
      const validation = await validateArticle(rest[0] || "", root);
      out(JSON.stringify(validation, null, 2));
      if (!validation.valid) {
        throw new CliError(
          "ARTICLE_INVALID",
          validation.errors.join("; ") || "Article validation failed.",
        );
      }
      return validation;
    }
    case "transition": {
      const article = await transitionArticle(
        rest[0] || "",
        rest[1] || "",
        {},
        root,
      );
      out(`${article.slug}: ${String(article.frontmatter.status)}`);
      return article;
    }
    case "lint": {
      const inputs = rest.includes("--all")
        ? (await listArticles(root)).map((article) => article.slug)
        : [rest.find((item) => !item.startsWith("--")) || ""];
      const reports = [];
      for (const input of inputs) {
        const report = await lintCommand(
          input,
          { fixSafe: rest.includes("--fix-safe") },
          root,
        );
        reports.push(report);
        out(
          rest.includes("--sarif")
            ? JSON.stringify(
                (await import("@mpforge/linter")).toSarif(report),
                null,
                2,
              )
            : rest.includes("--json")
              ? JSON.stringify(report, null, 2)
              : formatLintOutput(report),
        );
      }
      return rest.includes("--all") ? reports : reports[0];
    }
    case "render": {
      const result = await buildArticleArtifacts(rest[0] || "", root);
      out(path.join(result.article.articleDirectory, "build", "article.html"));
      return result;
    }
    case "preview": {
      const preview = await previewArticle(rest[0] || "", root);
      out(JSON.stringify(preview, null, 2));
      return preview;
    }
    case "assets": {
      const [action, input, source, ...flags] = rest;
      const actorIndex = flags.indexOf("--actor");
      const importedBy =
        actorIndex >= 0 ? flags[actorIndex + 1] || "" : "local-human";
      const result =
        action === "scan" || action === "inspect"
          ? await assetsScan(input || "", root)
          : action === "list"
            ? await assetsList(input || "", root)
            : action === "import"
              ? await assetsImport(
                  input || "",
                  source || "",
                  {
                    importedBy,
                    userOwned: flags.includes("--user-owned"),
                    rightsAcknowledged: flags.includes("--acknowledge-rights"),
                    generatedBy: flags.includes("--generated-by")
                      ? flags[flags.indexOf("--generated-by") + 1]
                      : undefined,
                  },
                  root,
                )
              : action === "optimize"
                ? await assetsOptimize(input || "", root)
                : action === "verify" || action === "verify-rights"
                  ? await assetsVerify(input || "", root)
                  : (() => {
                      throw new CliError(
                        "ASSET_COMMAND_INVALID",
                        "Usage: mpforge assets scan|list|inspect|import|optimize|verify <slug>",
                      );
                    })();
      out(JSON.stringify(result, null, 2));
      return result;
    }
    case "review": {
      const result = await prepareArticleReview(rest[0] || "", root);
      out(JSON.stringify(result, null, 2));
      return result;
    }
    case "request-review": {
      const article = await requestHumanReview(rest[0] || "", root);
      out(`${article.slug}: reviewing`);
      return article;
    }
    case "mark-reviewed": {
      const article = await markArticleReviewed(rest[0] || "", root);
      out(`${article.slug}: reviewed`);
      return article;
    }
    case "approve": {
      if (rest.some((item) => item === "--yes" || item.startsWith("--confirm")))
        throw new CliError(
          "APPROVAL_BYPASS_BLOCKED",
          "Approval flags are forbidden; use the interactive checklist.",
        );
      const result = await approveArticle(rest[0] || "", root);
      out("approved " + result.article.slug);
      return result;
    }
    case "revoke-approval": {
      const result = await revokeArticleApproval(rest[0] || "", root);
      out(JSON.stringify(result, null, 2));
      return result;
    }
    case "preflight": {
      const result = await preflightArticle(rest[0] || "", root);
      out(JSON.stringify(result, null, 2));
      return result;
    }
    case "account": {
      const [action, alias] = rest;
      const result =
        action === "list"
          ? await listAccountConfigurations(root)
          : action === "show"
            ? await showAccountConfiguration(root, alias || "")
            : action === "doctor"
              ? await doctorAccountConfiguration(root, alias || "")
              : (() => {
                  throw new CliError(
                    "ACCOUNT_COMMAND_INVALID",
                    "Usage: mpforge account list|show <alias>|doctor <alias>",
                  );
                })();
      out(JSON.stringify(result, null, 2));
      return result;
    }
    case "draft": {
      const [action, target, ...flags] = rest;
      const accountIndex = flags.indexOf("--account");
      const faultIndex = flags.indexOf("--fault");
      let result: unknown;
      if (action === "prepare") {
        const mock = flags.includes("--mock");
        result = await prepareDraft(root, target || "", {
          mode: mock ? "mock" : "real",
          accountAlias: accountIndex >= 0 ? flags[accountIndex + 1] : undefined,
        });
      } else if (action === "plan") {
        result = (await getDraftOperation(root, target || "")).plan;
      } else if (action === "status") {
        result = await getDraftOperation(root, target || "");
      } else if (action === "execute") {
        const operation = await getDraftOperation(root, target || "");
        const mockRequested = flags.includes("--mock");
        if (mockRequested !== (operation.plan.mode === "mock"))
          throw new CliError(
            "DRAFT_MODE_MISMATCH",
            operation.plan.mode === "mock"
              ? "Mock execution requires --mock."
              : "A real operation cannot be executed with --mock.",
          );
        result =
          operation.plan.mode === "real"
            ? await executeRealDraftInteractive(root, target || "")
            : await executeDraft(root, target || "", {
                fault:
                  faultIndex >= 0
                    ? (flags[faultIndex + 1] as NonNullable<
                        Parameters<typeof executeDraft>[2]
                      >["fault"])
                    : undefined,
              });
      } else if (action === "reconcile") {
        result = await reconcileDraft(root, target || "");
      } else if (action === "receipt") {
        result = await getDraftOperationReceipt(root, target || "");
      } else if (action === "cancel") {
        result = await cancelDraft(root, target || "");
      } else if (action === "list") {
        result = await listDraftOperations(root);
      } else {
        throw new CliError(
          "DRAFT_COMMAND_INVALID",
          "Usage: mpforge draft prepare <slug> --mock|--account <alias>; draft plan|execute|status|reconcile|receipt|cancel <operation_id>; draft list",
        );
      }
      out(JSON.stringify(result, null, 2));
      return result;
    }
    case "audit": {
      const result = await auditArticle(rest[0] || "", root);
      out(JSON.stringify(result, null, 2));
      return result;
    }
    case "doctor": {
      const result = await doctor(root);
      out(JSON.stringify(result, null, 2));
      return result;
    }
    default:
      throw new CliError(
        "UNKNOWN_COMMAND",
        "Usage: mpforge init|new|list|show|validate|transition|lint|assets|render|preview|review|request-review|mark-reviewed|approve|revoke-approval|preflight|account|draft|audit|doctor",
      );
  }
}

function formatLintOutput(report: Awaited<ReturnType<typeof lintCommand>>) {
  const lines = report.issues.map((item) => {
    const location = item.location
      ? report.articlePath +
        ":" +
        item.location.line +
        ":" +
        item.location.column
      : report.articlePath;
    return (
      location + " " + item.severity + " " + item.code + " " + item.message
    );
  });
  lines.push(
    (report.passed ? "PASS" : "FAIL") +
      ": " +
      report.summary.errors +
      " error(s), " +
      report.summary.warnings +
      " warning(s), " +
      report.summary.info +
      " info",
  );
  return lines.join("\n") + "\n";
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runCommand(process.argv.slice(2)).catch((error: unknown) => {
    if (error instanceof CliError) {
      console.error(error.code + ": " + error.message);
    } else {
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exitCode = 1;
  });
}
