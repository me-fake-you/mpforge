export type CredentialStatus =
  | "configured"
  | "missing"
  | "invalid"
  | "unverified";

export type DraftOperationStatus =
  | "PREPARED"
  | "EXECUTING"
  | "SUCCEEDED"
  | "FAILED"
  | "FAILED_WITH_REMOTE_ASSETS"
  | "UNKNOWN_REMOTE_STATE"
  | "RECONCILED_SUCCEEDED"
  | "RECONCILED_NOT_CREATED"
  | "CANCELLED";

export interface SafeAccount {
  alias: string;
  mode: "mock" | "real";
  display_name: string;
  enabled: boolean;
  credential_status: CredentialStatus;
  capability_status: string;
  capability_checked_at: string | null;
}

export interface DraftPlanView {
  operation_id: string;
  mode: "mock" | "real";
  account_alias: string;
  article_id: string;
  title: string;
  plan_hash: string;
  snapshot_inventory_hash: string;
  source_hash: string;
  rendered_html_hash: string;
  wechat_html_hash: string;
  lint_report_hash: string;
  preview_report_hash: string;
  assets_manifest_hash: string;
  approval_id: string;
  body_image_count: number;
  expected_remote_calls: Record<string, number>;
  expected_side_effects: string[];
  warnings: string[];
  orphan_asset_risk: boolean;
  created_at: string;
  expires_at: string;
}

export interface DraftStatusView {
  operation_id: string;
  status: DraftOperationStatus;
  sequence: number;
  updated_at: string;
  orphan_asset_risk: boolean;
  remote_assets: Array<Record<string, unknown>>;
  remote_draft_id: string | null;
  reconciliation_result: string | null;
  error_code: string | null;
  recommended_human_action: string | null;
}

export interface DraftEventView {
  event_id: string;
  sequence: number;
  at: string;
  type: string;
  status: DraftOperationStatus;
  data: Record<string, unknown>;
  event_hash: string;
}

export interface DraftOperationView {
  operation_id: string;
  plan: DraftPlanView;
  status: DraftStatusView;
  events: DraftEventView[];
}

export interface DraftOperationDetail
  extends Omit<DraftOperationView, "operation_id"> {
  receipt: Record<string, unknown> | null;
  reconciliation_receipt: Record<string, unknown> | null;
  asset_upload_map: Record<string, unknown> | null;
  request: Record<string, unknown> | null;
  response: Record<string, unknown> | null;
  real_execution_request: Record<string, unknown> | null;
}

export interface MockStateView {
  mock: true;
  account_alias: string;
  media_count: number;
  draft_count: number;
  active_fault: string | null;
  drafts: Array<{
    media_id: string;
    operation_id: string | null;
    plan_hash: string | null;
    created_at: string | null;
    title: string;
  }>;
  calls: Array<{
    at: string | null;
    method: string | null;
    path: string | null;
    status: number | null;
    fault: string | null;
  }>;
}

interface ApiResponse<T> {
  success: boolean;
  error?: string;
  accounts?: T;
  operations?: T;
  operation?: T;
  result?: T;
  state?: T;
  request?: T;
}

interface Round3Backend {
  listAccounts(): Promise<unknown>;
  doctorAccount(input: { alias: string }): Promise<unknown>;
  listOperations(): Promise<unknown>;
  getOperation(input: { operationId: string }): Promise<unknown>;
  getMockState(input: { accountAlias: string }): Promise<unknown>;
  prepareMock(input: { slug: string; accountAlias: string }): Promise<unknown>;
  executeMock(input: { operationId: string; fault?: string }): Promise<unknown>;
  reconcileMock(input: { operationId: string }): Promise<unknown>;
  requestReal(input: {
    operationId: string;
    requestedBy: string;
  }): Promise<unknown>;
}

const DEMO_TIME = "2026-01-01T08:00:00.000Z";
let demoSequence = 2;

function demoPlan(
  operationId: string,
  title: string,
  status: DraftOperationStatus,
  remoteDraftId: string | null,
): DraftOperationView {
  return {
    operation_id: operationId,
    plan: {
      operation_id: operationId,
      mode: "mock",
      account_alias: "mock-account",
      article_id: "demo-article-001",
      title,
      plan_hash: `demo-plan-hash-${operationId}`,
      snapshot_inventory_hash: "demo-snapshot-hash",
      source_hash: "demo-source-hash",
      rendered_html_hash: "demo-rendered-html-hash",
      wechat_html_hash: "demo-wechat-html-hash",
      lint_report_hash: "demo-lint-report-hash",
      preview_report_hash: "demo-preview-report-hash",
      assets_manifest_hash: "demo-assets-manifest-hash",
      approval_id: "demo-human-approval-001",
      body_image_count: 1,
      expected_remote_calls: { mock_upload: 1, mock_draft_create: 1 },
      expected_side_effects: ["mock_asset_upload", "mock_draft_create"],
      warnings: [],
      orphan_asset_risk: status === "UNKNOWN_REMOTE_STATE",
      created_at: DEMO_TIME,
      expires_at: "2030-01-01T00:00:00.000Z",
    },
    status: {
      operation_id: operationId,
      status,
      sequence: 1,
      updated_at: DEMO_TIME,
      orphan_asset_risk: status === "UNKNOWN_REMOTE_STATE",
      remote_assets: [
        {
          kind: "cover",
          asset_id: "demo-cover",
          remote_id: `mock-media-${operationId}`,
        },
      ],
      remote_draft_id: remoteDraftId,
      reconciliation_result: null,
      error_code:
        status === "UNKNOWN_REMOTE_STATE" ? "MOCK_RESPONSE_LOST" : null,
      recommended_human_action:
        status === "UNKNOWN_REMOTE_STATE"
          ? "Run read-only reconciliation before retrying."
          : null,
    },
    events: [
      {
        event_id: `demo-event-${operationId}-1`,
        sequence: 1,
        at: DEMO_TIME,
        type: "mock.demo_fixture",
        status,
        data: { network_mode: "mock-only" },
        event_hash: `demo-event-hash-${operationId}`,
      },
      ...(status === "SUCCEEDED"
        ? [
            {
              event_id: `demo-event-${operationId}-2`,
              sequence: 2,
              at: DEMO_TIME,
              type: "mock.asset_uploaded",
              status,
              data: { asset_id: "demo-cover", mock: true },
              event_hash: `demo-upload-hash-${operationId}`,
            },
            {
              event_id: `demo-event-${operationId}-3`,
              sequence: 3,
              at: DEMO_TIME,
              type: "mock.draft_created",
              status,
              data: { mock: true },
              event_hash: `demo-draft-hash-${operationId}`,
            },
            {
              event_id: `demo-event-${operationId}-4`,
              sequence: 4,
              at: DEMO_TIME,
              type: "mock.duplicate_prevented",
              status,
              data: { no_new_draft: true },
              event_hash: `demo-duplicate-hash-${operationId}`,
            },
          ]
        : []),
    ],
  };
}

const demoOperations: DraftOperationView[] = [
  demoPlan(
    "demo-op-succeeded",
    "Content-as-Code public demo",
    "SUCCEEDED",
    "mock-draft-demo-001",
  ),
  demoPlan(
    "demo-op-unknown",
    "Response-lost reconciliation example",
    "UNKNOWN_REMOTE_STATE",
    "mock-draft-demo-002",
  ),
];

function findDemoOperation(operationId: string): DraftOperationView {
  const operation = demoOperations.find(
    (candidate) => candidate.operation_id === operationId,
  );
  if (!operation) throw new Error("DEMO_OPERATION_NOT_FOUND");
  return operation;
}

function demoDetail(operation: DraftOperationView): DraftOperationDetail {
  return {
    plan: operation.plan,
    status: operation.status,
    events: operation.events,
    receipt:
      operation.status.status === "PREPARED"
        ? null
        : {
            receipt_id: `demo-receipt-${operation.operation_id}`,
            operation_id: operation.operation_id,
            provider_mode: "mock",
            outcome: operation.status.status,
            plan_hash: operation.plan.plan_hash,
            snapshot_inventory_hash: operation.plan.snapshot_inventory_hash,
            receipt_hash: `demo-receipt-hash-${operation.operation_id}`,
            remote_draft_id: operation.status.remote_draft_id,
            verification_status: "MOCK_E2E_VERIFIED",
            reconciliation_result: operation.status.reconciliation_result,
            orphan_asset_risk: operation.status.orphan_asset_risk,
            error_code: operation.status.error_code,
            remote_assets: operation.status.remote_assets,
            duplicate_prevented: operation.events.some(
              (event) => event.type === "mock.duplicate_prevented",
            ),
          },
    reconciliation_receipt: operation.status.reconciliation_result
      ? {
          operation_id: operation.operation_id,
          result: operation.status.reconciliation_result,
          read_only: true,
          mock: true,
        }
      : null,
    asset_upload_map: {
      assets: operation.status.remote_assets,
      mock: true,
    },
    request: { mock: true },
    response: { mock: true },
    real_execution_request: null,
  };
}

const demoBackend: Round3Backend = {
  async listAccounts() {
    return {
      success: true,
      accounts: [
        {
          alias: "mock-account",
          mode: "mock",
          display_name: "MPForge Public Demo",
          enabled: true,
          credential_status: "configured",
          capability_status: "MOCK_ONLY",
          capability_checked_at: DEMO_TIME,
        },
      ],
    };
  },
  async doctorAccount({ alias }) {
    return {
      success: true,
      result: {
        alias,
        mode: "mock",
        network_mode: "mock-only",
        real_wechat_disabled: true,
        secrets_read: false,
        status: "PASS",
      },
    };
  },
  async listOperations() {
    return { success: true, operations: demoOperations };
  },
  async getOperation({ operationId }) {
    return {
      success: true,
      operation: demoDetail(findDemoOperation(operationId)),
    };
  },
  async getMockState({ accountAlias }) {
    return {
      success: true,
      state: {
        mock: true,
        account_alias: accountAlias,
        media_count: demoOperations.reduce(
          (count, operation) => count + operation.status.remote_assets.length,
          0,
        ),
        draft_count: demoOperations.filter(
          (operation) => operation.status.remote_draft_id,
        ).length,
        active_fault: null,
        drafts: demoOperations.flatMap((operation) =>
          operation.status.remote_draft_id
            ? [
                {
                  media_id: operation.status.remote_draft_id,
                  operation_id: operation.operation_id,
                  plan_hash: operation.plan.plan_hash,
                  created_at: operation.status.updated_at,
                  title: operation.plan.title,
                },
              ]
            : [],
        ),
        calls: demoOperations.map((operation) => ({
          at: operation.status.updated_at,
          method: "POST",
          path: "/mock/cgi-bin/draft/add",
          status: operation.status.status === "SUCCEEDED" ? 200 : 504,
          fault:
            operation.status.status === "UNKNOWN_REMOTE_STATE"
              ? "created_but_response_lost"
              : null,
        })),
      } satisfies MockStateView,
    };
  },
  async prepareMock({ slug, accountAlias }) {
    if (!slug) return { success: false, error: "Select a demo article first." };
    demoSequence += 1;
    const operation = demoPlan(
      `demo-op-${demoSequence}`,
      `Prepared from ${slug}`,
      "PREPARED",
      null,
    );
    operation.plan.account_alias = accountAlias;
    demoOperations.unshift(operation);
    return { success: true, result: demoDetail(operation) };
  },
  async executeMock({ operationId, fault }) {
    const operation = findDemoOperation(operationId);
    if (
      ["SUCCEEDED", "RECONCILED_SUCCEEDED"].includes(operation.status.status)
    ) {
      operation.events.push({
        event_id: `demo-event-${operationId}-duplicate`,
        sequence: operation.events.length + 1,
        at: DEMO_TIME,
        type: "mock.duplicate_prevented",
        status: operation.status.status,
        data: { no_new_draft: true },
        event_hash: `demo-duplicate-hash-${operationId}`,
      });
      return { success: true, result: demoDetail(operation) };
    }
    const responseLost = fault === "created_but_response_lost";
    operation.status = {
      ...operation.status,
      status: responseLost ? "UNKNOWN_REMOTE_STATE" : "SUCCEEDED",
      sequence: operation.status.sequence + 1,
      remote_assets: [
        {
          kind: "cover",
          asset_id: "demo-cover",
          remote_id: `mock-media-${operationId}`,
        },
      ],
      remote_draft_id: `mock-draft-${operationId}`,
      orphan_asset_risk: responseLost,
      error_code: responseLost ? "MOCK_RESPONSE_LOST" : null,
      recommended_human_action: responseLost
        ? "Run read-only reconciliation before retrying."
        : null,
    };
    return { success: true, result: demoDetail(operation) };
  },
  async reconcileMock({ operationId }) {
    const operation = findDemoOperation(operationId);
    if (operation.status.status === "UNKNOWN_REMOTE_STATE") {
      operation.status = {
        ...operation.status,
        status: "RECONCILED_SUCCEEDED",
        sequence: operation.status.sequence + 1,
        orphan_asset_risk: false,
        error_code: null,
        reconciliation_result: "REMOTE_DRAFT_FOUND_BY_PLAN_HASH",
        recommended_human_action: null,
      };
    }
    return { success: true, result: demoDetail(operation) };
  },
  async requestReal() {
    return {
      success: false,
      error: "REAL_WECHAT_DISABLED_IN_PUBLIC_DEMO",
    };
  },
};

function api(): Round3Backend {
  if (isPublicDemoMode) return demoBackend;
  const value = window.electron?.round3;
  if (value) return value as unknown as Round3Backend;
  if (!value)
    throw new Error(
      "Round 3 operations require the controlled desktop backend.",
    );
  return value as unknown as Round3Backend;
}

function result<T>(response: ApiResponse<T>, key: keyof ApiResponse<T>): T {
  if (!response.success)
    throw new Error(response.error || "Round 3 action failed.");
  const value = response[key];
  if (value === undefined)
    throw new Error("Round 3 backend returned no result.");
  return value as T;
}

export const round3DraftClient = {
  available(): boolean {
    return isPublicDemoMode || Boolean(window.electron?.round3);
  },
  async listAccounts(): Promise<SafeAccount[]> {
    return result<SafeAccount[]>(
      (await api().listAccounts()) as unknown as ApiResponse<SafeAccount[]>,
      "accounts",
    );
  },
  async doctorAccount(alias: string): Promise<Record<string, unknown>> {
    return result<Record<string, unknown>>(
      (await api().doctorAccount({ alias })) as unknown as ApiResponse<
        Record<string, unknown>
      >,
      "result",
    );
  },
  async listOperations(): Promise<DraftOperationView[]> {
    return result<DraftOperationView[]>(
      (await api().listOperations()) as unknown as ApiResponse<
        DraftOperationView[]
      >,
      "operations",
    );
  },
  async getOperation(operationId: string): Promise<DraftOperationDetail> {
    return result<DraftOperationDetail>(
      (await api().getOperation({
        operationId,
      })) as unknown as ApiResponse<DraftOperationDetail>,
      "operation",
    );
  },
  async getMockState(accountAlias: string): Promise<MockStateView> {
    return result<MockStateView>(
      (await api().getMockState({
        accountAlias,
      })) as unknown as ApiResponse<MockStateView>,
      "state",
    );
  },
  async prepareMock(slug: string, accountAlias: string): Promise<unknown> {
    return result<unknown>(
      (await api().prepareMock({
        slug,
        accountAlias,
      })) as unknown as ApiResponse<unknown>,
      "result",
    );
  },
  async executeMock(operationId: string, fault?: string): Promise<unknown> {
    return result<unknown>(
      (await api().executeMock({
        operationId,
        fault,
      })) as unknown as ApiResponse<unknown>,
      "result",
    );
  },
  async reconcileMock(operationId: string): Promise<unknown> {
    return result<unknown>(
      (await api().reconcileMock({
        operationId,
      })) as unknown as ApiResponse<unknown>,
      "result",
    );
  },
  async requestReal(
    operationId: string,
    requestedBy: string,
  ): Promise<Record<string, unknown>> {
    return result<Record<string, unknown>>(
      (await api().requestReal({
        operationId,
        requestedBy,
      })) as unknown as ApiResponse<Record<string, unknown>>,
      "request",
    );
  },
};

export function visibleCredentialStatus(value: unknown): CredentialStatus {
  return ["configured", "missing", "invalid", "unverified"].includes(
    String(value),
  )
    ? (value as CredentialStatus)
    : "invalid";
}
import { isPublicDemoMode } from "../demo/demoMode";
