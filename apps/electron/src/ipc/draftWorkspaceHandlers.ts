import type { IpcMainInvokeEvent } from "electron";
import { ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { getWorkspaceDir, isPathInsideWorkspace } from "../workspace/state";

type DraftMode = "mock" | "real";

interface DraftPlan {
  operation_id: string;
  mode: DraftMode;
  account_alias: string;
  plan_hash: string;
  status: string;
  expected_side_effects?: string[];
  warnings?: string[];
  [key: string]: unknown;
}

interface DraftOperation {
  plan: DraftPlan;
  status: Record<string, unknown>;
  events: Array<Record<string, unknown>>;
}

interface CliModule {
  listAccountConfigurations: (
    root: string,
  ) => Promise<Array<Record<string, unknown>>>;
  doctorAccountConfiguration: (
    root: string,
    alias: string,
  ) => Promise<Record<string, unknown>>;
  listDraftOperations: (
    root: string,
  ) => Promise<Array<DraftOperation & { operation_id: string }>>;
  getDraftOperation: (
    root: string,
    operationId: string,
  ) => Promise<DraftOperation>;
  prepareDraft: (
    root: string,
    slug: string,
    input: { mode: DraftMode; accountAlias?: string },
  ) => Promise<unknown>;
  executeDraft: (
    root: string,
    operationId: string,
    options?: { fault?: string },
  ) => Promise<unknown>;
  reconcileDraft: (root: string, operationId: string) => Promise<unknown>;
}

const importEsm = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<unknown>;
let cliPromise: Promise<CliModule> | null = null;

function cli(): Promise<CliModule> {
  cliPromise ??= Promise.all([
    importEsm("@mpforge/cli/accounts"),
    importEsm("@mpforge/cli/drafts"),
  ]).then(([accounts, drafts]) => ({
    ...(accounts as Pick<
      CliModule,
      "listAccountConfigurations" | "doctorAccountConfiguration"
    >),
    ...(drafts as Omit<
      CliModule,
      "listAccountConfigurations" | "doctorAccountConfiguration"
    >),
  }));
  return cliPromise;
}

async function workspaceRoot(): Promise<string> {
  const selected = getWorkspaceDir();
  if (!selected) throw new Error("NO_WORKSPACE: Select a workspace first.");
  const root = await realpath(selected);
  if (!isPathInsideWorkspace(root)) throw new Error("WORKSPACE_PATH_INVALID");
  if (!(await stat(path.join(root, ".project-root.json"))).isFile()) {
    throw new Error("MPFORGE_WORKSPACE_REQUIRED");
  }
  return root;
}

function operationId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)
  ) {
    throw new Error("INVALID_OPERATION_ID");
  }
  return value;
}

function accountAlias(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    throw new Error("INVALID_ACCOUNT_ALIAS");
  }
  return value;
}

function articleSlug(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    throw new Error("INVALID_ARTICLE_SLUG");
  }
  return value;
}

function safeError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message.replace(/[\r\n]+/g, " ").slice(0, 600)
      : "Draft workspace action failed.";
  return { success: false as const, error: message };
}

async function optionalJson(
  directory: string,
  fileName: string,
): Promise<unknown | null> {
  if (!/^[a-z0-9.-]+\.json$/i.test(fileName)) {
    throw new Error("INVALID_OPERATION_FILE");
  }
  const candidate = path.join(directory, fileName);
  if (!isPathInsideWorkspace(candidate))
    throw new Error("OPERATION_PATH_ESCAPE");
  try {
    return JSON.parse(await readFile(candidate, "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function operationDetail(root: string, id: string) {
  const safeId = operationId(id);
  const operation = await (await cli()).getDraftOperation(root, safeId);
  const directory = path.join(root, "operations", safeId);
  return {
    ...operation,
    receipt: await optionalJson(directory, "receipt.json"),
    reconciliation_receipt: await optionalJson(
      directory,
      "reconciliation-receipt.json",
    ),
    asset_upload_map: await optionalJson(directory, "asset-upload-map.json"),
    request: await optionalJson(directory, "request.sanitized.json"),
    response: await optionalJson(directory, "response.sanitized.json"),
    real_execution_request: await optionalJson(
      directory,
      "human-execution-request.json",
    ),
  };
}

const mockFaults = new Set([
  "token_failure",
  "invalid_credentials",
  "ip_denied",
  "permission_denied",
  "body_image_n",
  "cover_failure",
  "payload_rejected",
  "server_error",
  "invalid_json",
  "timeout",
  "created_but_response_lost",
  "duplicate_request",
  "rate_limited",
  "remote_assets_without_draft",
]);

async function mockState(root: string, aliasValue: unknown) {
  const alias = accountAlias(aliasValue);
  const statePath = path.join(root, "tmp", "mock-wechat", alias, "state.json");
  if (!isPathInsideWorkspace(statePath))
    throw new Error("MOCK_STATE_PATH_ESCAPE");
  try {
    const state = JSON.parse(await readFile(statePath, "utf8")) as {
      mock?: unknown;
      media?: unknown[];
      drafts?: Array<Record<string, unknown>>;
      calls?: Array<Record<string, unknown>>;
      activeFault?: unknown;
    };
    if (
      state.mock !== true ||
      !Array.isArray(state.media) ||
      !Array.isArray(state.drafts)
    ) {
      throw new Error("MOCK_STATE_INVALID");
    }
    return {
      mock: true,
      account_alias: alias,
      media_count: state.media.length,
      draft_count: state.drafts.length,
      active_fault:
        typeof state.activeFault === "string" ? state.activeFault : null,
      drafts: state.drafts.map((draft) => {
        const articles = Array.isArray(draft.articles)
          ? (draft.articles as Array<Record<string, unknown>>)
          : [];
        return {
          media_id:
            typeof draft.mediaId === "string" ? draft.mediaId : "invalid",
          operation_id:
            typeof draft.operationId === "string" ? draft.operationId : null,
          plan_hash: typeof draft.planHash === "string" ? draft.planHash : null,
          created_at:
            typeof draft.createdAt === "string" ? draft.createdAt : null,
          title:
            typeof articles[0]?.title === "string"
              ? articles[0].title
              : "Untitled",
        };
      }),
      calls: Array.isArray(state.calls)
        ? state.calls.slice(-30).map((call) => ({
            at: typeof call.at === "string" ? call.at : null,
            method: typeof call.method === "string" ? call.method : null,
            path: typeof call.path === "string" ? call.path : null,
            status: typeof call.status === "number" ? call.status : null,
            fault: typeof call.fault === "string" ? call.fault : null,
          }))
        : [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        mock: true,
        account_alias: alias,
        media_count: 0,
        draft_count: 0,
        active_fault: null,
        drafts: [],
        calls: [],
      };
    }
    throw error;
  }
}

export function registerDraftWorkspaceHandlers(): void {
  ipcMain.handle("round3:accounts", async () => {
    try {
      const root = await workspaceRoot();
      return {
        success: true,
        accounts: await (await cli()).listAccountConfigurations(root),
      };
    } catch (error) {
      return safeError(error);
    }
  });

  ipcMain.handle(
    "round3:account-doctor",
    async (_event: IpcMainInvokeEvent, payload: { alias: string }) => {
      try {
        const root = await workspaceRoot();
        return {
          success: true,
          result: await (
            await cli()
          ).doctorAccountConfiguration(root, accountAlias(payload?.alias)),
        };
      } catch (error) {
        return safeError(error);
      }
    },
  );

  ipcMain.handle("round3:operations", async () => {
    try {
      const root = await workspaceRoot();
      return {
        success: true,
        operations: await (await cli()).listDraftOperations(root),
      };
    } catch (error) {
      return safeError(error);
    }
  });

  ipcMain.handle(
    "round3:operation",
    async (_event: IpcMainInvokeEvent, payload: { operationId: string }) => {
      try {
        const root = await workspaceRoot();
        return {
          success: true,
          operation: await operationDetail(root, payload?.operationId),
        };
      } catch (error) {
        return safeError(error);
      }
    },
  );

  ipcMain.handle(
    "round3:mock-state",
    async (_event: IpcMainInvokeEvent, payload: { accountAlias: string }) => {
      try {
        const root = await workspaceRoot();
        return {
          success: true,
          state: await mockState(root, payload?.accountAlias),
        };
      } catch (error) {
        return safeError(error);
      }
    },
  );

  ipcMain.handle(
    "round3:prepare-mock",
    async (
      _event: IpcMainInvokeEvent,
      payload: { slug: string; accountAlias: string },
    ) => {
      try {
        const root = await workspaceRoot();
        return {
          success: true,
          result: await (
            await cli()
          ).prepareDraft(root, articleSlug(payload?.slug), {
            mode: "mock",
            accountAlias: accountAlias(payload?.accountAlias),
          }),
        };
      } catch (error) {
        return safeError(error);
      }
    },
  );

  ipcMain.handle(
    "round3:execute-mock",
    async (
      _event: IpcMainInvokeEvent,
      payload: { operationId: string; fault?: string },
    ) => {
      try {
        const root = await workspaceRoot();
        const id = operationId(payload?.operationId);
        const operation = await (await cli()).getDraftOperation(root, id);
        if (operation.plan.mode !== "mock") {
          throw new Error("MOCK_OPERATION_REQUIRED");
        }
        if (payload.fault && !mockFaults.has(payload.fault)) {
          throw new Error("INVALID_MOCK_FAULT");
        }
        return {
          success: true,
          result: await (
            await cli()
          ).executeDraft(root, id, {
            ...(payload.fault ? { fault: payload.fault } : {}),
          }),
        };
      } catch (error) {
        return safeError(error);
      }
    },
  );

  ipcMain.handle(
    "round3:reconcile-mock",
    async (_event: IpcMainInvokeEvent, payload: { operationId: string }) => {
      try {
        const root = await workspaceRoot();
        const id = operationId(payload?.operationId);
        const operation = await (await cli()).getDraftOperation(root, id);
        if (operation.plan.mode !== "mock") {
          throw new Error("MOCK_OPERATION_REQUIRED");
        }
        return {
          success: true,
          result: await (await cli()).reconcileDraft(root, id),
        };
      } catch (error) {
        return safeError(error);
      }
    },
  );

  ipcMain.handle(
    "round3:request-real",
    async (
      _event: IpcMainInvokeEvent,
      payload: { operationId: string; requestedBy: string },
    ) => {
      try {
        const root = await workspaceRoot();
        const id = operationId(payload?.operationId);
        const requestedBy =
          typeof payload?.requestedBy === "string" &&
          /^[\p{L}\p{N}_.@ -]{1,100}$/u.test(payload.requestedBy.trim())
            ? payload.requestedBy.trim()
            : "";
        if (!requestedBy) throw new Error("HUMAN_REQUESTER_REQUIRED");
        const operation = await (await cli()).getDraftOperation(root, id);
        if (operation.plan.mode !== "real") {
          throw new Error("REAL_OPERATION_REQUIRED");
        }
        if (operation.status.status !== "PREPARED") {
          throw new Error("PREPARED_OPERATION_REQUIRED");
        }
        const directory = path.join(root, "operations", id);
        if (!isPathInsideWorkspace(directory))
          throw new Error("OPERATION_PATH_ESCAPE");
        if (!(await stat(directory)).isDirectory()) {
          throw new Error("OPERATION_DIRECTORY_REQUIRED");
        }
        const request = {
          schema: "mpforge.human-execution-request/v1",
          request_id: `human-request-${randomUUID()}`,
          title: "创建微信公众号草稿",
          confirmation_button: "确认创建公众号草稿",
          operation_id: operation.plan.operation_id,
          account_alias: operation.plan.account_alias,
          plan_hash: operation.plan.plan_hash,
          requested_by: requestedBy,
          requested_at: new Date().toISOString(),
          status: "AWAITING_INTERACTIVE_HUMAN_TERMINAL",
          expected_side_effects: operation.plan.expected_side_effects ?? [],
          warnings: operation.plan.warnings ?? [],
          challenge_code: null,
          next_step:
            "A human must independently run the interactive CLI command in a TTY. This request does not execute the operation.",
        };
        const target = path.join(directory, "human-execution-request.json");
        await writeFile(target, `${JSON.stringify(request, null, 2)}\n`, {
          encoding: "utf8",
          flag: "wx",
        });
        return { success: true, request };
      } catch (error) {
        return safeError(error);
      }
    },
  );
}
