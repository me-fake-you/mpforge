import { useCallback, useEffect, useMemo, useState } from "react";
import type { FileItem } from "../../store/fileTypes";
import type { WorkbenchEvidence } from "../../services/mpforgeWorkbench";
import {
  round3DraftClient,
  visibleCredentialStatus,
  type DraftOperationDetail,
  type DraftOperationView,
  type MockStateView,
  type SafeAccount,
} from "../../services/round3DraftWorkspace";
import "./Round3DraftWorkspace.css";
import { isPublicDemoMode } from "../../demo/demoMode";

type DraftWorkspaceTab =
  | "accounts"
  | "preparation"
  | "mock"
  | "real"
  | "operations"
  | "receipt";

const tabs: Array<{ id: DraftWorkspaceTab; label: string }> = [
  { id: "accounts", label: "Accounts" },
  { id: "preparation", label: "Draft Preparation" },
  { id: "mock", label: "Mock Draft" },
  { id: "real", label: "Real Draft Confirmation" },
  { id: "operations", label: "Operations" },
  { id: "receipt", label: "Receipt" },
];

const visibleTabs = isPublicDemoMode
  ? tabs.filter((tab) => tab.id !== "real")
  : tabs;

const mockFaults = [
  "",
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
];

function articleSlug(file: FileItem | null): string {
  if (!file) return "";
  const normalized = file.path.replace(/\\/g, "/");
  return /(?:^|\/)content\/([^/]+)\/article\.md$/i.exec(normalized)?.[1] ?? "";
}

function statusOf(operation: DraftOperationView): string {
  return operation.status?.status ?? "UNKNOWN";
}

function operationLabel(operation: DraftOperationView): string {
  return `${operation.plan.title} · ${operation.plan.mode.toUpperCase()} · ${statusOf(operation)}`;
}

function Field({ label, value }: { label: string; value: unknown }) {
  return (
    <span className="round3-draft__field">
      <strong>{label}</strong>
      <code>{value === null || value === undefined ? "—" : String(value)}</code>
    </span>
  );
}

function OperationPicker({
  operations,
  value,
  onChange,
  mode,
}: {
  operations: DraftOperationView[];
  value: string;
  onChange: (value: string) => void;
  mode?: "mock" | "real";
}) {
  const visible = mode
    ? operations.filter((operation) => operation.plan.mode === mode)
    : operations;
  return (
    <label className="round3-draft__control">
      Operation
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Select an immutable operation</option>
        {visible.map((operation) => (
          <option key={operation.operation_id} value={operation.operation_id}>
            {operationLabel(operation)}
          </option>
        ))}
      </select>
    </label>
  );
}

function PlanSummary({ operation }: { operation: DraftOperationView | null }) {
  if (!operation) {
    return (
      <p className="round3-draft__empty">
        Select an operation to inspect its immutable plan.
      </p>
    );
  }
  const plan = operation.plan;
  return (
    <div
      className="round3-draft__summary"
      aria-label="Immutable operation plan"
    >
      <Field label="operation_id" value={plan.operation_id} />
      <Field label="account_alias" value={plan.account_alias} />
      <Field label="mode" value={plan.mode} />
      <Field label="status" value={statusOf(operation)} />
      <Field label="plan_hash" value={plan.plan_hash} />
      <Field
        label="snapshot_inventory_hash"
        value={plan.snapshot_inventory_hash}
      />
      <Field label="source_hash" value={plan.source_hash} />
      <Field label="rendered_html_hash" value={plan.rendered_html_hash} />
      <Field label="wechat_html_hash" value={plan.wechat_html_hash} />
      <Field label="assets_manifest_hash" value={plan.assets_manifest_hash} />
      <Field label="lint_report_hash" value={plan.lint_report_hash} />
      <Field label="preview_report_hash" value={plan.preview_report_hash} />
      <Field label="approval_id" value={plan.approval_id} />
      <Field label="expires_at" value={plan.expires_at} />
    </div>
  );
}

function AccountsPane({
  accounts,
  onDoctor,
  doctorResult,
}: {
  accounts: SafeAccount[];
  onDoctor: (alias: string) => void;
  doctorResult: Record<string, unknown> | null;
}) {
  return (
    <section className="round3-draft__pane" aria-label="Accounts workspace">
      <header>
        <span className="workspace-hub__eyebrow">SAFE ACCOUNT CONFIG</span>
        <h1>Accounts</h1>
        <p>
          Only account aliases, mode, capability metadata and the four
          credential states are visible. Credential values are never returned to
          this page.
        </p>
      </header>
      <div className="round3-draft__accounts">
        {accounts.map((account) => (
          <article key={account.alias}>
            <div>
              <strong>{account.display_name}</strong>
              <code>{account.alias}</code>
            </div>
            <span data-mode={account.mode}>{account.mode.toUpperCase()}</span>
            <span
              data-credential={visibleCredentialStatus(
                account.credential_status,
              )}
            >
              {visibleCredentialStatus(account.credential_status)}
            </span>
            <small>{account.capability_status}</small>
            <button type="button" onClick={() => onDoctor(account.alias)}>
              Local doctor
            </button>
          </article>
        ))}
      </div>
      {doctorResult && (
        <div className="round3-draft__notice" data-tone="neutral">
          Doctor: {String(doctorResult.alias)} · {String(doctorResult.mode)} ·{" "}
          {visibleCredentialStatus(doctorResult.credential_status)} · live
          network calls {String(doctorResult.live_network_calls ?? 0)}
        </div>
      )}
    </section>
  );
}

function PreparationPane({
  currentFile,
  evidence,
  accounts,
  onPrepare,
  busy,
}: {
  currentFile: FileItem | null;
  evidence: WorkbenchEvidence;
  accounts: SafeAccount[];
  onPrepare: (account: string) => void;
  busy: boolean;
}) {
  const mockAccounts = accounts.filter(
    (account) => account.mode === "mock" && account.enabled,
  );
  const [account, setAccount] = useState("");
  useEffect(() => {
    if (!account && mockAccounts[0]) setAccount(mockAccounts[0].alias);
  }, [account, mockAccounts]);
  const slug = articleSlug(currentFile);
  const previewReady = Boolean(
    evidence.preview?.chromiumComplete && !evidence.preview.stale,
  );
  const rightsReady = evidence.assets.every(
    (asset) => asset.rightsStatus === "approved",
  );
  const ready =
    Boolean(slug) &&
    evidence.status === "approved" &&
    evidence.lint?.summary.errors === 0 &&
    previewReady &&
    rightsReady &&
    Boolean(account);
  return (
    <section
      className="round3-draft__pane"
      aria-label="Draft Preparation workspace"
    >
      <header>
        <span className="workspace-hub__eyebrow">
          PREPARE · NO REMOTE CALLS
        </span>
        <h1>Draft Preparation</h1>
        <p>
          Freeze article, build, lint, preview, approval and assets into one
          immutable operation. Desktop preparation is MOCK-only; real plans are
          prepared in the human CLI workflow.
        </p>
      </header>
      <div className="round3-draft__gates">
        <span data-ready={Boolean(slug)}>
          Article: {slug || "not selected"}
        </span>
        <span data-ready={evidence.status === "approved"}>
          Content approval: {evidence.status}
        </span>
        <span data-ready={evidence.lint?.summary.errors === 0}>
          Lint: {evidence.lint?.summary.errors ?? "—"} ERROR
        </span>
        <span data-ready={previewReady}>
          Chromium preview: {previewReady ? "current" : "missing or STALE"}
        </span>
        <span data-ready={rightsReady}>
          Asset rights: {rightsReady ? "approved" : "not ready"}
        </span>
      </div>
      <label className="round3-draft__control">
        MOCK account
        <select
          value={account}
          onChange={(event) => setAccount(event.target.value)}
        >
          <option value="">Select account</option>
          {mockAccounts.map((item) => (
            <option key={item.alias} value={item.alias}>
              {item.display_name} ({item.alias})
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="workspace-hub__primary"
        disabled={!ready || busy}
        onClick={() => onPrepare(account)}
      >
        {busy
          ? "Preparing immutable snapshot…"
          : "Prepare immutable MOCK operation"}
      </button>
    </section>
  );
}

function MockPane({
  operations,
  selectedId,
  onSelect,
  onExecute,
  onReconcile,
  mockState,
  busy,
}: {
  operations: DraftOperationView[];
  selectedId: string;
  onSelect: (id: string) => void;
  onExecute: (fault?: string) => void;
  onReconcile: () => void;
  mockState: MockStateView | null;
  busy: boolean;
}) {
  const [fault, setFault] = useState("");
  const selected =
    operations.find(
      (operation) =>
        operation.operation_id === selectedId && operation.plan.mode === "mock",
    ) ?? null;
  return (
    <section className="round3-draft__pane" aria-label="Mock Draft workspace">
      <header>
        <span className="round3-draft__mock-badge">MOCK · LOCAL ONLY</span>
        <h1>Mock Draft</h1>
        <p>
          This flow uses the project-local WeChat simulator. A MOCK result is
          never evidence of a live account draft.
        </p>
      </header>
      <OperationPicker
        operations={operations}
        value={selectedId}
        onChange={onSelect}
        mode="mock"
      />
      <PlanSummary operation={selected} />
      <label className="round3-draft__control">
        Optional MOCK fault injection
        <select
          value={fault}
          onChange={(event) => setFault(event.target.value)}
        >
          {mockFaults.map((item) => (
            <option key={item || "success"} value={item}>
              {item || "success path"}
            </option>
          ))}
        </select>
      </label>
      <div className="round3-draft__actions">
        <button
          type="button"
          className="workspace-hub__primary"
          disabled={!selected || statusOf(selected) !== "PREPARED" || busy}
          onClick={() => onExecute(fault || undefined)}
        >
          {busy ? "Running MOCK…" : "Execute MOCK operation"}
        </button>
        <button
          type="button"
          disabled={
            !selected || statusOf(selected) !== "UNKNOWN_REMOTE_STATE" || busy
          }
          onClick={onReconcile}
        >
          Reconcile UNKNOWN_REMOTE_STATE (read only)
        </button>
      </div>
      {selected && (
        <div className="round3-draft__progress">
          <strong>Upload / draft progress</strong>
          <span>Status: {statusOf(selected)}</span>
          <span>
            Remote assets recorded: {selected.status.remote_assets?.length ?? 0}
          </span>
          <span>
            Draft id: {selected.status.remote_draft_id ?? "not created"}
          </span>
          <span>
            Orphan risk: {String(selected.status.orphan_asset_risk ?? false)}
          </span>
          <span>
            Reconciliation: {selected.status.reconciliation_result ?? "not run"}
          </span>
        </div>
      )}
      {mockState && (
        <div className="round3-draft__mock-state">
          <strong>MOCK service state</strong>
          <span>
            {mockState.media_count} media · {mockState.draft_count} drafts
          </span>
          {mockState.drafts.map((draft) => (
            <article key={draft.media_id}>
              <strong>{draft.title}</strong>
              <code>{draft.media_id}</code>
              <small>{draft.operation_id ?? "legacy mock"}</small>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function RealPane({
  operations,
  selectedId,
  onSelect,
  onRequest,
  busy,
  request,
}: {
  operations: DraftOperationView[];
  selectedId: string;
  onSelect: (id: string) => void;
  onRequest: (requestedBy: string) => void;
  busy: boolean;
  request: Record<string, unknown> | null;
}) {
  const [requestedBy, setRequestedBy] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const selected =
    operations.find(
      (operation) =>
        operation.operation_id === selectedId && operation.plan.mode === "real",
    ) ?? null;
  const ready = Boolean(
    selected &&
      selected.plan.mode === "real" &&
      statusOf(selected) === "PREPARED" &&
      requestedBy.trim() &&
      acknowledged,
  );
  return (
    <section
      className="round3-draft__pane"
      aria-label="Real Draft Confirmation workspace"
    >
      <header>
        <span className="workspace-hub__eyebrow">
          HUMAN REQUEST · NO EXECUTION HERE
        </span>
        <h1>创建微信公众号草稿</h1>
        <p>
          This page records a request bound to an existing real plan. It does
          not obtain credentials, show or accept a challenge code, call WeChat,
          or execute the operation. Final authorization remains in an
          independent interactive human terminal.
        </p>
      </header>
      <OperationPicker
        operations={operations}
        value={selectedId}
        onChange={onSelect}
        mode="real"
      />
      <PlanSummary operation={selected} />
      {selected && (
        <div className="round3-draft__effects">
          <strong>Expected side effects</strong>
          <ul>
            {(selected.plan.expected_side_effects ?? []).map((effect) => (
              <li key={effect}>{effect}</li>
            ))}
          </ul>
          <strong>Warnings</strong>
          <ul>
            {(selected.plan.warnings ?? []).map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
      <label className="round3-draft__control">
        Human requester ID
        <input
          value={requestedBy}
          onChange={(event) => setRequestedBy(event.target.value)}
          autoComplete="off"
        />
      </label>
      <label className="round3-draft__ack">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
        />
        I understand this only creates a local human execution request.
      </label>
      <button
        type="button"
        className="workspace-hub__primary"
        disabled={!ready || busy}
        onClick={() => onRequest(requestedBy.trim())}
      >
        确认创建公众号草稿
      </button>
      {request && (
        <div className="round3-draft__notice" data-tone="success">
          Request recorded: {String(request.request_id)} ·{" "}
          {String(request.status)}. No remote call was made.
        </div>
      )}
    </section>
  );
}

function OperationsPane({
  operations,
  selectedId,
  onSelect,
  detail,
}: {
  operations: DraftOperationView[];
  selectedId: string;
  onSelect: (id: string) => void;
  detail: DraftOperationDetail | null;
}) {
  const selected =
    operations.find((operation) => operation.operation_id === selectedId) ??
    null;
  return (
    <section className="round3-draft__pane" aria-label="Operations workspace">
      <header>
        <span className="workspace-hub__eyebrow">LOCAL OPERATION LEDGER</span>
        <h1>Operations</h1>
        <p>Inspect immutable plans, current status and append-only events.</p>
      </header>
      <div className="round3-draft__operation-list">
        {operations.map((operation) => (
          <button
            type="button"
            key={operation.operation_id}
            data-selected={operation.operation_id === selectedId}
            onClick={() => onSelect(operation.operation_id)}
          >
            <strong>{operation.plan.title}</strong>
            <code>{operation.operation_id}</code>
            <span>
              {operation.plan.mode.toUpperCase()} · {statusOf(operation)}
            </span>
          </button>
        ))}
      </div>
      <PlanSummary operation={selected} />
      {detail && (
        <>
          <div className="round3-draft__progress">
            <strong>Current status</strong>
            <span>{detail.status.status}</span>
            <span>Error: {detail.status.error_code ?? "none"}</span>
            <span>
              Recommended action:{" "}
              {detail.status.recommended_human_action ?? "none"}
            </span>
          </div>
          <div className="round3-draft__events" aria-label="Operation events">
            {detail.events.map((event) => (
              <article key={event.event_id}>
                <strong>
                  #{event.sequence} {event.type}
                </strong>
                <span>
                  {event.status} · {event.at}
                </span>
                <code>{event.event_hash}</code>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function ReceiptPane({
  operations,
  selectedId,
  onSelect,
  detail,
}: {
  operations: DraftOperationView[];
  selectedId: string;
  onSelect: (id: string) => void;
  detail: DraftOperationDetail | null;
}) {
  const receipt = detail?.reconciliation_receipt ?? detail?.receipt ?? null;
  const remoteAssets = Array.isArray(receipt?.remote_assets)
    ? (receipt.remote_assets as Array<Record<string, unknown>>)
    : [];
  return (
    <section className="round3-draft__pane" aria-label="Receipt workspace">
      <header>
        <span className="workspace-hub__eyebrow">SANITIZED LOCAL EVIDENCE</span>
        <h1>Receipt</h1>
        <p>
          Receipts contain hashes, safe identifiers and outcomes—not
          credentials.
        </p>
      </header>
      <OperationPicker
        operations={operations}
        value={selectedId}
        onChange={onSelect}
      />
      {!receipt ? (
        <p className="round3-draft__empty">
          No receipt is available for this operation.
        </p>
      ) : (
        <article
          className="round3-draft__receipt"
          data-mock={receipt.provider_mode === "mock"}
        >
          {receipt.provider_mode === "mock" && (
            <span className="round3-draft__mock-badge">MOCK RECEIPT</span>
          )}
          <div className="round3-draft__summary">
            <Field label="receipt_id" value={receipt.receipt_id} />
            <Field label="operation_id" value={receipt.operation_id} />
            <Field label="provider_mode" value={receipt.provider_mode} />
            <Field label="outcome" value={receipt.outcome} />
            <Field label="plan_hash" value={receipt.plan_hash} />
            <Field
              label="snapshot_inventory_hash"
              value={receipt.snapshot_inventory_hash}
            />
            <Field label="receipt_hash" value={receipt.receipt_hash} />
            <Field label="remote_draft_id" value={receipt.remote_draft_id} />
            <Field
              label="verification_status"
              value={receipt.verification_status}
            />
            <Field
              label="reconciliation_result"
              value={receipt.reconciliation_result}
            />
            <Field
              label="orphan_asset_risk"
              value={receipt.orphan_asset_risk}
            />
            <Field label="error_code" value={receipt.error_code} />
          </div>
          <div className="round3-draft__remote-assets">
            <strong>Asset upload map</strong>
            {remoteAssets.map((asset, index) => (
              <span key={`${String(asset.asset_id)}-${index}`}>
                {String(asset.kind)} · {String(asset.asset_id)} ·{" "}
                {String(asset.remote_id ?? "no remote id")}
              </span>
            ))}
          </div>
        </article>
      )}
    </section>
  );
}

export function Round3DraftWorkspace({
  currentFile,
  evidence,
}: {
  currentFile: FileItem | null;
  evidence: WorkbenchEvidence;
}) {
  const [activeTab, setActiveTab] = useState<DraftWorkspaceTab>("accounts");
  const [accounts, setAccounts] = useState<SafeAccount[]>([]);
  const [operations, setOperations] = useState<DraftOperationView[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<DraftOperationDetail | null>(null);
  const [mockState, setMockState] = useState<MockStateView | null>(null);
  const [doctorResult, setDoctorResult] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [realRequest, setRealRequest] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!round3DraftClient.available()) return;
    const [nextAccounts, nextOperations] = await Promise.all([
      round3DraftClient.listAccounts(),
      round3DraftClient.listOperations(),
    ]);
    setAccounts(nextAccounts);
    setOperations(nextOperations);
    setSelectedId((current) =>
      current &&
      nextOperations.some((operation) => operation.operation_id === current)
        ? current
        : (nextOperations[0]?.operation_id ?? ""),
    );
  }, []);

  useEffect(() => {
    void refresh().catch((cause) =>
      setError(
        cause instanceof Error
          ? cause.message
          : "Round 3 state failed to load.",
      ),
    );
  }, [refresh]);

  useEffect(() => {
    if (!selectedId || !round3DraftClient.available()) {
      setDetail(null);
      return;
    }
    let current = true;
    void round3DraftClient
      .getOperation(selectedId)
      .then((value) => {
        if (current) setDetail(value);
      })
      .catch((cause) => {
        if (current)
          setError(
            cause instanceof Error
              ? cause.message
              : "Operation failed to load.",
          );
      });
    return () => {
      current = false;
    };
  }, [selectedId, operations]);

  const selected = useMemo(
    () =>
      operations.find((operation) => operation.operation_id === selectedId) ??
      null,
    [operations, selectedId],
  );

  useEffect(() => {
    const alias =
      selected?.plan.mode === "mock" ? selected.plan.account_alias : null;
    if (!alias || !round3DraftClient.available()) {
      setMockState(null);
      return;
    }
    let current = true;
    void round3DraftClient.getMockState(alias).then((state) => {
      if (current) setMockState(state);
    });
    return () => {
      current = false;
    };
  }, [selected]);

  const action = async (work: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await work();
      await refresh();
      setMessage(success);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Round 3 action failed.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="round3-draft" data-active-workspace={activeTab}>
      <nav
        className="round3-draft__tabs"
        aria-label="Draft pipeline workspaces"
      >
        {visibleTabs.map((tab) => (
          <button
            type="button"
            key={tab.id}
            aria-current={activeTab === tab.id ? "page" : undefined}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      {!round3DraftClient.available() && (
        <div className="round3-draft__notice" data-tone="warning" role="alert">
          The six workspaces are visible, but operations require the controlled
          desktop backend.
        </div>
      )}
      {isPublicDemoMode && (
        <div className="round3-draft__notice" data-tone="success" role="status">
          Public Demo: this workspace runs entirely in browser memory with Mock
          WeChat. Real Draft Confirmation is intentionally unavailable.
        </div>
      )}
      {error && (
        <div className="round3-draft__notice" data-tone="error" role="alert">
          {error}
        </div>
      )}
      {message && (
        <div className="round3-draft__notice" data-tone="success">
          {message}
        </div>
      )}
      {activeTab === "accounts" && (
        <AccountsPane
          accounts={accounts}
          doctorResult={doctorResult}
          onDoctor={(alias) =>
            void action(async () => {
              setDoctorResult(await round3DraftClient.doctorAccount(alias));
            }, `Account ${alias} checked locally.`)
          }
        />
      )}
      {activeTab === "preparation" && (
        <PreparationPane
          currentFile={currentFile}
          evidence={evidence}
          accounts={accounts}
          busy={busy}
          onPrepare={(account) =>
            void action(
              () =>
                round3DraftClient.prepareMock(
                  articleSlug(currentFile),
                  account,
                ),
              "Immutable MOCK operation prepared.",
            )
          }
        />
      )}
      {activeTab === "mock" && (
        <MockPane
          operations={operations}
          selectedId={selectedId}
          onSelect={setSelectedId}
          mockState={mockState}
          busy={busy}
          onExecute={(fault) =>
            void action(
              () => round3DraftClient.executeMock(selectedId, fault),
              "MOCK execution finished; inspect status and receipt.",
            )
          }
          onReconcile={() =>
            void action(
              () => round3DraftClient.reconcileMock(selectedId),
              "Read-only MOCK reconciliation finished.",
            )
          }
        />
      )}
      {activeTab === "real" && (
        <RealPane
          operations={operations}
          selectedId={selectedId}
          onSelect={setSelectedId}
          busy={busy}
          request={realRequest ?? detail?.real_execution_request ?? null}
          onRequest={(requestedBy) =>
            void action(async () => {
              setRealRequest(
                await round3DraftClient.requestReal(selectedId, requestedBy),
              );
            }, "Local human execution request recorded; no remote call was made.")
          }
        />
      )}
      {activeTab === "operations" && (
        <OperationsPane
          operations={operations}
          selectedId={selectedId}
          onSelect={setSelectedId}
          detail={detail}
        />
      )}
      {activeTab === "receipt" && (
        <ReceiptPane
          operations={operations}
          selectedId={selectedId}
          onSelect={setSelectedId}
          detail={detail}
        />
      )}
    </section>
  );
}
