import {
  ORIGINAL_THEMES,
  assetsOptimize,
  assetsScan,
  assetsVerify,
  auditArticle,
  doctorAccountConfiguration,
  executeDraft,
  findWorkspaceRoot,
  getDraftOperation,
  getDraftOperationReceipt,
  lintCommand,
  listAccountConfigurations,
  listArticles,
  listDraftOperations,
  prepareDraft,
  prepareArticleReview,
  previewArticle,
  readArticle,
  reconcileDraft,
  requestHumanReview,
  renderArticle,
  makeLintReport,
  type CliError,
} from "@mpforge/cli";

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export const TOOL_DEFINITIONS = [
  {
    name: "list_articles",
    description: "List Content-as-Code articles in the local workspace.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "get_article",
    description: "Read an article frontmatter and Markdown body.",
    inputSchema: {
      type: "object",
      required: ["article"],
      properties: { article: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "render_article",
    description: "Render an article through the installed MPForge renderer.",
    inputSchema: {
      type: "object",
      required: ["article"],
      properties: {
        article: { type: "string" },
        mode: { enum: ["light", "dark"] },
      },
      additionalProperties: false,
    },
  },
  {
    name: "lint_article",
    description: "Run deterministic WeChat compatibility lint.",
    inputSchema: {
      type: "object",
      required: ["article"],
      properties: { article: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "get_lint_report",
    description: "Read or regenerate the current deterministic lint report.",
    inputSchema: {
      type: "object",
      required: ["article"],
      properties: { article: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "apply_safe_fixes",
    description:
      "Apply only allowlisted transactional safe fixes, then rerun lint.",
    inputSchema: {
      type: "object",
      required: ["article"],
      properties: { article: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "scan_article_assets",
    description: "Discover article assets without making network requests.",
    inputSchema: {
      type: "object",
      required: ["article"],
      properties: { article: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "inspect_article_assets",
    description:
      "Inspect the manifest and rights blockers without changing rights.",
    inputSchema: {
      type: "object",
      required: ["article"],
      properties: { article: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "optimize_article_assets",
    description: "Create traceable derived images while preserving originals.",
    inputSchema: {
      type: "object",
      required: ["article"],
      properties: { article: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "generate_article_previews",
    description:
      "Generate local source/safe/WeChat light/dark mobile evidence.",
    inputSchema: {
      type: "object",
      required: ["article"],
      properties: { article: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "get_preview_report",
    description: "Regenerate and return the hash-bound preview report.",
    inputSchema: {
      type: "object",
      required: ["article"],
      properties: { article: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "prepare_review",
    description: "Prepare the human checklist and report approval blockers.",
    inputSchema: {
      type: "object",
      required: ["article"],
      properties: { article: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "request_human_review",
    description: "Move a draft to reviewing; this tool can never approve.",
    inputSchema: {
      type: "object",
      required: ["article"],
      properties: { article: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "get_review_status",
    description: "Read review evidence, blockers, checklist, and audit status.",
    inputSchema: {
      type: "object",
      required: ["article"],
      properties: { article: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "get_approval_status",
    description:
      "Read the append-only approval/invalidation status; never approve.",
    inputSchema: {
      type: "object",
      required: ["article"],
      properties: { article: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "list_themes",
    description: "List the four original MPForge themes.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "list_wechat_accounts",
    description: "List safe account metadata without credential values.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "get_wechat_account_status",
    description: "Read one safe account status without credential values.",
    inputSchema: {
      type: "object",
      required: ["account_alias"],
      properties: { account_alias: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "check_wechat_account_configuration",
    description: "Run local-only configuration checks with zero live calls.",
    inputSchema: {
      type: "object",
      required: ["account_alias"],
      properties: { account_alias: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "prepare_mock_draft",
    description: "Freeze an approved article into a local mock operation plan.",
    inputSchema: {
      type: "object",
      required: ["article"],
      properties: {
        article: { type: "string" },
        account_alias: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "execute_mock_draft",
    description: "Execute a prepared operation against loopback Mock WeChat.",
    inputSchema: {
      type: "object",
      required: ["operation_id"],
      properties: { operation_id: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "prepare_real_draft",
    description:
      "Prepare a real-account plan only; this tool can never execute it.",
    inputSchema: {
      type: "object",
      required: ["article", "account_alias"],
      properties: {
        article: { type: "string" },
        account_alias: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  ...[
    ["get_draft_operation_plan", "Read an immutable operation plan."],
    [
      "get_draft_operation_status",
      "Read operation status and hash-chained events.",
    ],
    [
      "request_human_draft_execution",
      "Return handoff instructions for a human session; never execute real work.",
    ],
    [
      "reconcile_draft_operation",
      "Perform read-only reconciliation for an uncertain operation.",
    ],
    ["get_draft_receipt", "Read and verify a hash-bound draft receipt."],
  ].map(([name, description]) => ({
    name,
    description,
    inputSchema: {
      type: "object",
      required: ["operation_id"],
      properties: { operation_id: { type: "string" } },
      additionalProperties: false,
    },
  })),
  {
    name: "list_draft_operations",
    description: "List local draft operations and their safe status metadata.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
] as const;

function textResult(value: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function argument(
  params: Record<string, unknown> | undefined,
  key: string,
): string {
  const value = params?.[key];
  if (typeof value !== "string" || !value.trim())
    throw new Error("Missing required argument: " + key);
  return value;
}

export async function callTool(
  name: string,
  params: Record<string, unknown> = {},
  root = findWorkspaceRoot(),
): Promise<unknown> {
  const articleName = () => argument(params, "article");
  switch (name) {
    case "list_articles":
      return textResult(await listArticles(root));
    case "get_article": {
      const article = await readArticle(articleName(), root);
      return textResult({
        slug: article.slug,
        path: article.articlePath,
        frontmatter: article.frontmatter,
        body: article.body,
        validation: article.frontmatterValidation,
      });
    }
    case "render_article": {
      const article = await readArticle(articleName(), root);
      return textResult(
        await renderArticle(article, params.mode === "dark" ? "dark" : "light"),
      );
    }
    case "lint_article":
    case "get_lint_report":
      return textResult(await lintCommand(articleName(), {}, root));
    case "apply_safe_fixes":
      return textResult(
        await lintCommand(articleName(), { fixSafe: true }, root),
      );
    case "scan_article_assets":
      return textResult(await assetsScan(articleName(), root));
    case "inspect_article_assets":
      return textResult(await assetsVerify(articleName(), root));
    case "optimize_article_assets":
      return textResult(await assetsOptimize(articleName(), root));
    case "generate_article_previews":
    case "get_preview_report":
      return textResult(await previewArticle(articleName(), root));
    case "prepare_review":
    case "get_review_status":
    case "get_approval_status":
      return textResult(await prepareArticleReview(articleName(), root));
    case "request_human_review":
      return textResult(await requestHumanReview(articleName(), root));
    case "list_themes":
      return textResult(ORIGINAL_THEMES);
    case "list_wechat_accounts":
      return textResult(await listAccountConfigurations(root));
    case "get_wechat_account_status":
      return textResult(
        (await listAccountConfigurations(root)).find(
          (account) => account.alias === argument(params, "account_alias"),
        ) ?? null,
      );
    case "check_wechat_account_configuration":
      return textResult(
        await doctorAccountConfiguration(
          root,
          argument(params, "account_alias"),
        ),
      );
    case "prepare_mock_draft":
      return textResult(
        await prepareDraft(root, articleName(), {
          mode: "mock",
          accountAlias:
            typeof params.account_alias === "string"
              ? params.account_alias
              : undefined,
        }),
      );
    case "execute_mock_draft":
      return textResult(
        await executeDraft(root, argument(params, "operation_id")),
      );
    case "prepare_real_draft":
      return textResult(
        await prepareDraft(root, articleName(), {
          mode: "real",
          accountAlias: argument(params, "account_alias"),
        }),
      );
    case "get_draft_operation_plan":
      return textResult(
        (await getDraftOperation(root, argument(params, "operation_id"))).plan,
      );
    case "get_draft_operation_status":
      return textResult(
        await getDraftOperation(root, argument(params, "operation_id")),
      );
    case "request_human_draft_execution": {
      const operation = await getDraftOperation(
        root,
        argument(params, "operation_id"),
      );
      return textResult({
        operation_id: operation.plan.operation_id,
        account_alias: operation.plan.account_alias,
        plan_hash: operation.plan.plan_hash,
        requires_interactive_human_session: true,
        mcp_execution_allowed: false,
        instruction: `Run mpforge draft execute ${operation.plan.operation_id} in a direct interactive human session.`,
      });
    }
    case "reconcile_draft_operation":
      return textResult(
        await reconcileDraft(root, argument(params, "operation_id")),
      );
    case "get_draft_receipt":
      return textResult(
        await getDraftOperationReceipt(root, argument(params, "operation_id")),
      );
    case "list_draft_operations":
      return textResult(await listDraftOperations(root));
    default:
      throw new Error("Unknown MCP tool: " + name);
  }
}

export async function handleMessage(
  request: JsonRpcRequest,
  root = findWorkspaceRoot(),
): Promise<JsonRpcResponse | null> {
  if (request.method.startsWith("notifications/")) return null;
  const id = request.id ?? null;
  try {
    if (request.method === "initialize") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "mpforge", version: "0.1.0" },
        },
      };
    }
    if (request.method === "tools/list") {
      return { jsonrpc: "2.0", id, result: { tools: TOOL_DEFINITIONS } };
    }
    if (request.method === "tools/call") {
      const params = request.params ?? {};
      const name = argument(params, "name");
      const toolArgs =
        params.arguments && typeof params.arguments === "object"
          ? (params.arguments as Record<string, unknown>)
          : {};
      return {
        jsonrpc: "2.0",
        id,
        result: await callTool(name, toolArgs, root),
      };
    }
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: "Method not found" },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32000, message },
    };
  }
}
