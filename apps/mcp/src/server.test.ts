import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TOOL_DEFINITIONS, handleMessage } from "./server.js";

describe("MPForge MCP stdio protocol", () => {
  it("exposes the safe Round 3 draft surface without real execution", () => {
    expect(TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual([
      "list_articles",
      "get_article",
      "render_article",
      "lint_article",
      "get_lint_report",
      "apply_safe_fixes",
      "scan_article_assets",
      "inspect_article_assets",
      "optimize_article_assets",
      "generate_article_previews",
      "get_preview_report",
      "prepare_review",
      "request_human_review",
      "get_review_status",
      "get_approval_status",
      "list_themes",
      "list_wechat_accounts",
      "get_wechat_account_status",
      "check_wechat_account_configuration",
      "prepare_mock_draft",
      "execute_mock_draft",
      "prepare_real_draft",
      "get_draft_operation_plan",
      "get_draft_operation_status",
      "request_human_draft_execution",
      "reconcile_draft_operation",
      "get_draft_receipt",
      "list_draft_operations",
    ]);
    expect(
      TOOL_DEFINITIONS.some((tool) =>
        [
          "execute_real_draft",
          "publish_article",
          "formal_publish",
          "mass_send",
          "approve_and_publish",
        ].includes(tool.name),
      ),
    ).toBe(false);
  });

  it("handles initialize and tools/list with JSON-RPC shapes", async () => {
    const parent = path.join(process.cwd(), "tmp");
    await mkdir(parent, { recursive: true });
    const root = await mkdtemp(path.join(parent, "mpforge-mcp-"));
    try {
      const init = await handleMessage(
        { jsonrpc: "2.0", id: 1, method: "initialize" },
        root,
      );
      expect(init?.result).toMatchObject({ protocolVersion: "2024-11-05" });
      const list = await handleMessage(
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
        root,
      );
      expect((list?.result as { tools: unknown[] }).tools).toHaveLength(28);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects any attempted approval tool", async () => {
    const response = await handleMessage({
      jsonrpc: "2.0",
      id: "real",
      method: "tools/call",
      params: { name: "approve_article", arguments: { article: "x" } },
    });
    expect(response?.error?.message).toContain("Unknown MCP tool");
  });
});
