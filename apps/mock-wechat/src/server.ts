import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import path from "node:path";

export const MOCK_FAULTS = [
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
] as const;

export type MockFault = (typeof MOCK_FAULTS)[number];
export type MockMediaKind = "body" | "cover" | "legacy";

export interface MockMedia {
  mediaId: string;
  relativePath: string;
  contentHash: string;
  mimeType: string;
  dataBase64: string;
  kind: MockMediaKind;
  url: string;
  createdAt: string;
}

export interface MockDraftArticle {
  title: string;
  author: string;
  digest: string;
  content: string;
  contentSourceUrl: string;
  thumbMediaId: string | null;
  bodyImageMediaIds: string[];
  needOpenComment: number;
  onlyFansCanComment: number;
}

export interface MockDraft {
  mediaId: string;
  articles: MockDraftArticle[];
  idempotencyKey: string | null;
  operationId: string | null;
  planHash: string | null;
  requestFingerprint: string;
  createdAt: string;
}

export interface MockCallLog {
  at: string;
  method: string;
  path: string;
  status: number;
  fault: MockFault | null;
  requestKeys: string[];
}

export interface MockWechatState {
  media: Map<string, MockMedia>;
  drafts: Map<string, MockDraft>;
  idempotency: Map<string, string>;
  calls: MockCallLog[];
  activeFault: MockFault | null;
  bodyImageFailureAt: number;
  bodyImageUploadCount: number;
  /** Compatibility switch for older local callers. Uploaded assets remain intact. */
  failDraftCreation: boolean;
}

export interface MockWechatServerOptions {
  port?: number;
  host?: "127.0.0.1";
  /** Omit for an in-memory run. Persisted runs must explicitly choose this path. */
  dataDir?: string;
  projectRoot?: string;
  /** Tests may use an OS temporary directory. Never set this in an application. */
  testOnlyAllowTempDataDir?: boolean;
  faultDelayMs?: number;
}

export interface MockWechatServer {
  server: Server;
  url: string;
  state: MockWechatState;
  dataDir: string | null;
  close(): Promise<void>;
}

const MAX_REQUEST_BODY_BYTES = 25 * 1024 * 1024;
const FETCH_BLOCKED_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79,
  87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137,
  139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532,
  540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723,
  2049, 3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697,
  10080,
]);

class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

function mockJson(
  response: ServerResponse,
  status: number,
  value: Record<string, unknown>,
): void {
  const data = JSON.stringify({ ...value, mock: true });
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(data),
    "cache-control": "no-store",
  });
  response.end(data);
}

function errorJson(
  response: ServerResponse,
  status: number,
  errcode: number,
  errmsg: string,
): void {
  mockJson(response, status, { errcode, errmsg, error: errmsg });
}

function html(response: ServerResponse, status: number, value: string): void {
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(value),
    "cache-control": "no-store",
  });
  response.end(value);
}

async function requestBody(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > MAX_REQUEST_BODY_BYTES)
      throw new RequestError(413, 40013, "REQUEST_BODY_TOO_LARGE");
    chunks.push(buffer);
  }
  const data = Buffer.concat(chunks);
  if (!data.length) return {};
  try {
    const value = JSON.parse(data.toString("utf8")) as unknown;
    if (!value || Array.isArray(value) || typeof value !== "object")
      throw new Error("not an object");
    return value as Record<string, unknown>;
  } catch {
    throw new RequestError(400, 40014, "INVALID_JSON");
  }
}

function stringField(
  input: Record<string, unknown>,
  snake: string,
  camel = snake,
): string | undefined {
  const value = input[snake] ?? input[camel];
  return typeof value === "string" ? value : undefined;
}

function optionalString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeRequestKeys(input: Record<string, unknown>): string[] {
  return Object.keys(input)
    .filter((key) => !/secret|token|password|cookie|private.?key/i.test(key))
    .sort();
}

function isFault(value: string | undefined): value is MockFault {
  return MOCK_FAULTS.includes(value as MockFault);
}

function requestedFault(
  request: IncomingMessage,
  state: MockWechatState,
): MockFault | null {
  const header = request.headers["x-mpforge-fault"];
  const value = Array.isArray(header) ? header[0] : header;
  return isFault(value) ? value : state.activeFault;
}

function assertSafeMockSecret(input: Record<string, unknown>): void {
  const secret = stringField(input, "app_secret", "appSecret");
  if (!secret) return;
  if (!/^(mock|test)[_-]/i.test(secret))
    throw new RequestError(400, 40001, "REAL_CREDENTIAL_REJECTED");
}

function normalizeDataDir(options: MockWechatServerOptions): string | null {
  if (!options.dataDir) return null;
  const dataDir = path.resolve(options.dataDir);
  if (options.testOnlyAllowTempDataDir) return dataDir;
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const allowed = [
    path.resolve(projectRoot, "tmp", "mock-wechat"),
    path.resolve(projectRoot, "artifacts", "mock-wechat"),
  ];
  const valid = allowed.some(
    (root) => dataDir === root || dataDir.startsWith(`${root}${path.sep}`),
  );
  if (!valid) throw new Error("MOCK_DATA_DIR_OUTSIDE_ALLOWED_PROJECT_PATHS");
  return dataDir;
}

function serializableState(state: MockWechatState): Record<string, unknown> {
  return {
    schemaVersion: 1,
    mock: true,
    media: [...state.media.values()].map(
      ({ dataBase64: _data, ...item }) => item,
    ),
    drafts: [...state.drafts.values()],
    calls: state.calls,
    activeFault: state.activeFault,
    bodyImageFailureAt: state.bodyImageFailureAt,
  };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || Array.isArray(value) || typeof value !== "object")
    throw new Error("MOCK_STATE_INVALID");
  return value as Record<string, unknown>;
}

function requiredString(value: Record<string, unknown>, key: string): string {
  if (typeof value[key] !== "string") throw new Error("MOCK_STATE_INVALID");
  return value[key];
}

function restoredArticle(value: unknown): MockDraftArticle {
  const item = record(value);
  if (!Array.isArray(item.bodyImageMediaIds))
    throw new Error("MOCK_STATE_INVALID");
  const bodyImageMediaIds = item.bodyImageMediaIds.map((mediaId) => {
    if (typeof mediaId !== "string") throw new Error("MOCK_STATE_INVALID");
    return mediaId;
  });
  const thumbMediaId = item.thumbMediaId;
  if (thumbMediaId !== null && typeof thumbMediaId !== "string")
    throw new Error("MOCK_STATE_INVALID");
  if (
    typeof item.needOpenComment !== "number" ||
    typeof item.onlyFansCanComment !== "number"
  )
    throw new Error("MOCK_STATE_INVALID");
  return {
    title: requiredString(item, "title"),
    author: requiredString(item, "author"),
    digest: requiredString(item, "digest"),
    content: requiredString(item, "content"),
    contentSourceUrl: requiredString(item, "contentSourceUrl"),
    thumbMediaId,
    bodyImageMediaIds,
    needOpenComment: item.needOpenComment,
    onlyFansCanComment: item.onlyFansCanComment,
  };
}

function nullableString(
  value: Record<string, unknown>,
  key: string,
): string | null {
  const field = value[key];
  if (field !== null && typeof field !== "string")
    throw new Error("MOCK_STATE_INVALID");
  return field;
}

async function restoreState(dataDir: string | null): Promise<MockWechatState> {
  const empty: MockWechatState = {
    media: new Map(),
    drafts: new Map(),
    idempotency: new Map(),
    calls: [],
    activeFault: null,
    bodyImageFailureAt: 1,
    bodyImageUploadCount: 0,
    failDraftCreation: false,
  };
  if (!dataDir) return empty;
  let raw: string;
  try {
    raw = await readFile(path.join(dataDir, "state.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty;
    throw new Error("MOCK_STATE_INVALID");
  }
  try {
    const saved = record(JSON.parse(raw) as unknown);
    if (
      saved.mock !== true ||
      saved.schemaVersion !== 1 ||
      !Array.isArray(saved.media) ||
      !Array.isArray(saved.drafts) ||
      !Array.isArray(saved.calls)
    )
      throw new Error("MOCK_STATE_INVALID");

    for (const value of saved.media) {
      const item = record(value);
      const mediaId = requiredString(item, "mediaId");
      const kind = requiredString(item, "kind");
      if (
        !/^mock-(body|cover|legacy)-[a-z0-9-]+$/i.test(mediaId) ||
        !["body", "cover", "legacy"].includes(kind)
      )
        throw new Error("MOCK_STATE_INVALID");
      const bytes = await readFile(
        path.join(dataDir, "media", `${mediaId}.bin`),
      );
      const contentHash = requiredString(item, "contentHash");
      if (
        /^[a-f0-9]{64}$/i.test(contentHash) &&
        createHash("sha256").update(bytes).digest("hex") !== contentHash
      )
        throw new Error("MOCK_STATE_INVALID");
      empty.media.set(mediaId, {
        mediaId,
        relativePath: requiredString(item, "relativePath"),
        contentHash,
        mimeType: requiredString(item, "mimeType"),
        dataBase64: bytes.toString("base64"),
        kind: kind as MockMediaKind,
        url: requiredString(item, "url"),
        createdAt: requiredString(item, "createdAt"),
      });
    }

    for (const value of saved.drafts) {
      const item = record(value);
      const mediaId = requiredString(item, "mediaId");
      if (
        !/^mock-draft-[a-z0-9-]+$/i.test(mediaId) ||
        !Array.isArray(item.articles)
      )
        throw new Error("MOCK_STATE_INVALID");
      const draft: MockDraft = {
        mediaId,
        articles: item.articles.map(restoredArticle),
        idempotencyKey: nullableString(item, "idempotencyKey"),
        operationId: nullableString(item, "operationId"),
        planHash: nullableString(item, "planHash"),
        requestFingerprint: requiredString(item, "requestFingerprint"),
        createdAt: requiredString(item, "createdAt"),
      };
      empty.drafts.set(mediaId, draft);
      if (draft.idempotencyKey) {
        if (empty.idempotency.has(draft.idempotencyKey))
          throw new Error("MOCK_STATE_INVALID");
        empty.idempotency.set(draft.idempotencyKey, mediaId);
      }
    }

    empty.calls = saved.calls.map((value) => {
      const item = record(value);
      if (!Array.isArray(item.requestKeys) || typeof item.status !== "number")
        throw new Error("MOCK_STATE_INVALID");
      const requestKeys = item.requestKeys.map((key) => {
        if (
          typeof key !== "string" ||
          /secret|token|password|cookie|private.?key/i.test(key)
        )
          throw new Error("MOCK_STATE_INVALID");
        return key;
      });
      const fault = item.fault;
      if (fault !== null && (typeof fault !== "string" || !isFault(fault)))
        throw new Error("MOCK_STATE_INVALID");
      return {
        at: requiredString(item, "at"),
        method: requiredString(item, "method"),
        path: requiredString(item, "path"),
        status: item.status,
        fault,
        requestKeys,
      };
    });
    return empty;
  } catch {
    throw new Error("MOCK_STATE_INVALID");
  }
}

async function persist(
  state: MockWechatState,
  dataDir: string | null,
  call?: MockCallLog,
): Promise<void> {
  if (!dataDir) return;
  await Promise.all([
    mkdir(path.join(dataDir, "drafts"), { recursive: true }),
    mkdir(path.join(dataDir, "media"), { recursive: true }),
  ]);
  for (const item of state.media.values())
    await writeFile(
      path.join(dataDir, "media", `${item.mediaId}.bin`),
      Buffer.from(item.dataBase64, "base64"),
    );
  await writeFile(
    path.join(dataDir, "state.json"),
    `${JSON.stringify(serializableState(state), null, 2)}\n`,
    "utf8",
  );
  if (call)
    await appendFile(
      path.join(dataDir, "calls.jsonl"),
      `${JSON.stringify({ ...call, mock: true })}\n`,
      "utf8",
    );
  for (const draft of state.drafts.values())
    await writeFile(
      path.join(dataDir, "drafts", `${draft.mediaId}.html`),
      renderDraftHtml(draft),
      "utf8",
    );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderDraftHtml(draft: MockDraft): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(draft.articles[0]?.title ?? "Mock Draft")}</title><style>body{max-width:760px;margin:32px auto;padding:0 20px;font:16px/1.7 system-ui;color:#202124}header{border-bottom:1px solid #ddd;margin-bottom:24px}.badge{color:#067d68;font-weight:700}</style></head><body><header><p class="badge">LOCAL MOCK PREVIEW</p><code>${escapeHtml(draft.mediaId)}</code></header>${draft.articles.map((article) => `<article><h1>${escapeHtml(article.title)}</h1><p>${escapeHtml(article.author)}</p>${article.content}</article>`).join("\n")}</body></html>`;
}

function mediaInput(input: Record<string, unknown>): {
  relativePath: string;
  contentHash: string;
  mimeType: string;
  dataBase64: string;
} {
  const relativePath = stringField(input, "relative_path", "relativePath");
  const contentHash = stringField(input, "content_hash", "contentHash");
  const mimeType = stringField(input, "mime_type", "mimeType");
  const dataBase64 = stringField(input, "data_base64", "data");
  if (!relativePath || !contentHash || !mimeType || !dataBase64)
    throw new RequestError(400, 40015, "INVALID_MEDIA");
  if (!/^[a-f0-9]{6,128}$/i.test(contentHash) && contentHash !== "hash")
    throw new RequestError(400, 40016, "INVALID_CONTENT_HASH");
  return { relativePath, contentHash, mimeType, dataBase64 };
}

function draftArticle(
  input: Record<string, unknown>,
  legacyMediaIds: string[] = [],
): MockDraftArticle {
  const title = optionalString(input.title);
  const content = optionalString(input.content);
  if (!title || !content)
    throw new RequestError(400, 40017, "INVALID_DRAFT_PAYLOAD");
  const bodyIdsValue = input.body_image_media_ids ?? input.bodyImageMediaIds;
  const bodyImageMediaIds = Array.isArray(bodyIdsValue)
    ? bodyIdsValue.filter((value): value is string => typeof value === "string")
    : legacyMediaIds;
  return {
    title,
    author: optionalString(input.author),
    digest: optionalString(input.digest ?? input.summary),
    content,
    contentSourceUrl: optionalString(
      input.content_source_url ?? input.contentSourceUrl,
    ),
    thumbMediaId:
      typeof (input.thumb_media_id ?? input.thumbMediaId) === "string"
        ? String(input.thumb_media_id ?? input.thumbMediaId)
        : null,
    bodyImageMediaIds,
    needOpenComment: Number(
      input.need_open_comment ?? input.needOpenComment ?? 0,
    ),
    onlyFansCanComment: Number(
      input.only_fans_can_comment ?? input.onlyFansCanComment ?? 0,
    ),
  };
}

function normalizeDraftInput(input: Record<string, unknown>): {
  articles: MockDraftArticle[];
  idempotencyKey: string | null;
  operationId: string | null;
  planHash: string | null;
} {
  const legacyMediaIds = Array.isArray(input.mediaIds)
    ? input.mediaIds.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  const articles = Array.isArray(input.articles)
    ? input.articles.map((article) => {
        if (!article || Array.isArray(article) || typeof article !== "object")
          throw new RequestError(400, 40017, "INVALID_DRAFT_PAYLOAD");
        return draftArticle(article as Record<string, unknown>);
      })
    : [draftArticle(input, legacyMediaIds)];
  if (!articles.length)
    throw new RequestError(400, 40017, "INVALID_DRAFT_PAYLOAD");
  return {
    articles,
    idempotencyKey:
      stringField(input, "idempotency_key", "idempotencyKey") ?? null,
    operationId: stringField(input, "operation_id", "operationId") ?? null,
    planHash: stringField(input, "plan_hash", "planHash") ?? null,
  };
}

function draftResponse(draft: MockDraft): Record<string, unknown> {
  return {
    media_id: draft.mediaId,
    news_item: draft.articles.map((article) => ({
      title: article.title,
      author: article.author,
      digest: article.digest,
      content: article.content,
      content_source_url: article.contentSourceUrl,
      thumb_media_id: article.thumbMediaId,
      need_open_comment: article.needOpenComment,
      only_fans_can_comment: article.onlyFansCanComment,
    })),
    idempotency_key: draft.idempotencyKey,
    operation_id: draft.operationId,
    plan_hash: draft.planHash,
    request_fingerprint: draft.requestFingerprint,
    update_time: draft.createdAt,
  };
}

function adminPage(state: MockWechatState): string {
  const faultOptions = ["", ...MOCK_FAULTS]
    .map(
      (fault) =>
        `<option${fault === state.activeFault ? " selected" : ""}>${escapeHtml(fault)}</option>`,
    )
    .join("");
  const drafts = [...state.drafts.values()]
    .map(
      (draft) =>
        `<li><a href="/v1/drafts/${encodeURIComponent(draft.mediaId)}/preview">${escapeHtml(draft.articles[0]?.title ?? draft.mediaId)}</a> <code>${escapeHtml(draft.mediaId)}</code></li>`,
    )
    .join("");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>MPForge Mock WeChat</title><style>body{max-width:920px;margin:32px auto;font:15px/1.6 system-ui}code{background:#eee;padding:2px 5px}table{border-collapse:collapse}td,th{padding:6px 10px;border:1px solid #ddd}.notice{color:#067d68;font-weight:700}</style></head><body><h1>MPForge Mock WeChat</h1><p class="notice">LOCAL MOCK ONLY · 127.0.0.1</p><p>Media: ${state.media.size} · Drafts: ${state.drafts.size} · Calls: ${state.calls.length}</p><form method="post" action="/admin/faults"><label>Fault <select name="fault">${faultOptions}</select></label><p>Use JSON API <code>POST /admin/faults</code> to configure fault injection.</p></form><h2>Draft previews</h2><ul>${drafts || "<li>None</li>"}</ul><h2>Sanitized calls</h2><table><tr><th>Time</th><th>Method</th><th>Path</th><th>Status</th><th>Fault</th></tr>${state.calls
    .slice(-50)
    .reverse()
    .map(
      (call) =>
        `<tr><td>${escapeHtml(call.at)}</td><td>${escapeHtml(call.method)}</td><td>${escapeHtml(call.path)}</td><td>${call.status}</td><td>${escapeHtml(call.fault ?? "")}</td></tr>`,
    )
    .join("")}</table></body></html>`;
}

function faultError(
  fault: MockFault,
): { status: number; code: number; message: string } | null {
  switch (fault) {
    case "token_failure":
      return { status: 502, code: -1000, message: "MOCK_TOKEN_FAILURE" };
    case "invalid_credentials":
      return { status: 401, code: 40001, message: "MOCK_INVALID_CREDENTIALS" };
    case "ip_denied":
      return { status: 403, code: 40164, message: "MOCK_IP_DENIED" };
    case "permission_denied":
      return { status: 403, code: 48001, message: "MOCK_PERMISSION_DENIED" };
    case "cover_failure":
      return { status: 502, code: -1002, message: "MOCK_COVER_FAILURE" };
    case "payload_rejected":
      return { status: 422, code: 44003, message: "MOCK_PAYLOAD_REJECTED" };
    case "server_error":
      return { status: 500, code: -1003, message: "MOCK_SERVER_ERROR" };
    case "duplicate_request":
      return { status: 409, code: -1004, message: "MOCK_DUPLICATE_REQUEST" };
    case "rate_limited":
      return { status: 429, code: 45009, message: "MOCK_RATE_LIMITED" };
    case "remote_assets_without_draft":
      return {
        status: 502,
        code: -1005,
        message: "MOCK_REMOTE_ASSETS_WITHOUT_DRAFT",
      };
    default:
      return null;
  }
}

export async function startMockWechatServer(
  portOrOptions: number | MockWechatServerOptions = {},
): Promise<MockWechatServer> {
  const options: MockWechatServerOptions =
    typeof portOrOptions === "number" ? { port: portOrOptions } : portOrOptions;
  if (options.host && options.host !== "127.0.0.1")
    throw new Error("MOCK_SERVER_LOOPBACK_ONLY");
  const dataDir = normalizeDataDir(options);
  const state = await restoreState(dataDir);

  const server = createServer(async (request, response) => {
    const requestUrl = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? "127.0.0.1"}`,
    );
    const fault = requestUrl.pathname.startsWith("/admin")
      ? null
      : requestedFault(request, state);
    let input: Record<string, unknown> = {};
    const finish = async (status: number): Promise<void> => {
      const call: MockCallLog = {
        at: new Date().toISOString(),
        method: request.method ?? "UNKNOWN",
        path: requestUrl.pathname,
        status,
        fault,
        requestKeys: safeRequestKeys(input),
      };
      state.calls.push(call);
      await persist(state, dataDir, call);
    };

    try {
      if (fault === "timeout")
        await new Promise((resolve) =>
          setTimeout(resolve, options.faultDelayMs ?? 30_000),
        );
      if (fault === "invalid_json") {
        await finish(502);
        response.writeHead(502, { "content-type": "application/json" });
        response.end('{"mock":true,"errcode":-1006,');
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/health") {
        await finish(200);
        mockJson(response, 200, {
          ok: true,
          service: "mock-wechat",
          bind: "127.0.0.1",
          persisted: Boolean(dataDir),
        });
        return;
      }
      if (
        request.method === "GET" &&
        requestUrl.pathname === "/v1/capabilities"
      ) {
        await finish(200);
        mockJson(response, 200, {
          provider_mode: "mock",
          operations: [
            "obtainAccessToken",
            "uploadBodyImage",
            "uploadCoverMaterial",
            "createDraft",
            "getDraft",
            "listDrafts",
            "findPossibleDraft",
          ],
          faults: MOCK_FAULTS,
        });
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/admin") {
        await finish(200);
        html(response, 200, adminPage(state));
        return;
      }
      if (
        request.method === "POST" &&
        requestUrl.pathname === "/admin/faults"
      ) {
        input = await requestBody(request);
        const selected = stringField(input, "fault");
        if (selected && !isFault(selected))
          throw new RequestError(400, 40018, "UNKNOWN_MOCK_FAULT");
        state.activeFault = selected && isFault(selected) ? selected : null;
        const failureAt = Number(input.body_image_failure_at ?? 1);
        state.bodyImageFailureAt =
          Number.isInteger(failureAt) && failureAt > 0 ? failureAt : 1;
        state.bodyImageUploadCount = 0;
        await finish(200);
        mockJson(response, 200, {
          ok: true,
          active_fault: state.activeFault,
          body_image_failure_at: state.bodyImageFailureAt,
        });
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/v1/token") {
        input = await requestBody(request);
        assertSafeMockSecret(input);
        if (
          fault === "token_failure" ||
          fault === "invalid_credentials" ||
          fault === "ip_denied" ||
          fault === "permission_denied" ||
          fault === "server_error" ||
          fault === "rate_limited"
        ) {
          const result = faultError(fault)!;
          await finish(result.status);
          errorJson(response, result.status, result.code, result.message);
          return;
        }
        const accountAlias =
          stringField(input, "account_alias", "accountAlias") ?? "mock";
        await finish(200);
        mockJson(response, 200, {
          access_token: `mock-token-${sha256(accountAlias).slice(0, 16)}`,
          expires_in: 7200,
        });
        return;
      }

      const mediaRoute =
        request.method === "POST" &&
        ["/v1/media", "/v1/body-images", "/v1/cover-materials"].includes(
          requestUrl.pathname,
        );
      if (mediaRoute) {
        input = await requestBody(request);
        const kind: MockMediaKind =
          requestUrl.pathname === "/v1/cover-materials"
            ? "cover"
            : requestUrl.pathname === "/v1/media"
              ? "legacy"
              : "body";
        if (kind === "body") state.bodyImageUploadCount += 1;
        const bodyFailure =
          fault === "body_image_n" &&
          kind === "body" &&
          state.bodyImageUploadCount === state.bodyImageFailureAt;
        if (
          bodyFailure ||
          (fault === "cover_failure" && kind === "cover") ||
          fault === "server_error" ||
          fault === "rate_limited" ||
          fault === "permission_denied"
        ) {
          const result = bodyFailure
            ? { status: 502, code: -1001, message: "MOCK_BODY_IMAGE_N_FAILURE" }
            : faultError(fault!)!;
          await finish(result.status);
          errorJson(response, result.status, result.code, result.message);
          return;
        }
        const parsed = mediaInput(input);
        const mediaId = `mock-${kind}-${randomUUID()}`;
        const item: MockMedia = {
          mediaId,
          ...parsed,
          kind,
          url: `/v1/media/${encodeURIComponent(mediaId)}`,
          createdAt: new Date().toISOString(),
        };
        state.media.set(mediaId, item);
        await finish(200);
        mockJson(response, 200, { media_id: mediaId, mediaId, url: item.url });
        return;
      }

      const mediaMatch = requestUrl.pathname.match(/^\/v1\/media\/([^/]+)$/);
      if (request.method === "GET" && mediaMatch) {
        const item = state.media.get(decodeURIComponent(mediaMatch[1]));
        if (!item) throw new RequestError(404, 40007, "MEDIA_NOT_FOUND");
        const data = Buffer.from(item.dataBase64, "base64");
        await finish(200);
        response.writeHead(200, {
          "content-type": item.mimeType,
          "content-length": data.byteLength,
          "cache-control": "no-store",
          "x-mpforge-provider-mode": "mock",
        });
        response.end(data);
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/v1/drafts") {
        input = await requestBody(request);
        if (
          state.failDraftCreation ||
          fault === "payload_rejected" ||
          fault === "server_error" ||
          fault === "duplicate_request" ||
          fault === "rate_limited" ||
          fault === "permission_denied" ||
          fault === "remote_assets_without_draft"
        ) {
          const result = state.failDraftCreation
            ? {
                status: 502,
                code: -1005,
                message: "MOCK_REMOTE_ASSETS_WITHOUT_DRAFT",
              }
            : faultError(fault!)!;
          await finish(result.status);
          errorJson(response, result.status, result.code, result.message);
          return;
        }
        const normalized = normalizeDraftInput(input);
        const referenced = normalized.articles.flatMap((article) => [
          ...article.bodyImageMediaIds,
          ...(article.thumbMediaId ? [article.thumbMediaId] : []),
        ]);
        if (referenced.some((mediaId) => !state.media.has(mediaId)))
          throw new RequestError(409, 40007, "MEDIA_NOT_FOUND");
        const fingerprint = sha256(JSON.stringify(normalized));
        if (normalized.idempotencyKey) {
          const existingId = state.idempotency.get(normalized.idempotencyKey);
          if (existingId) {
            const existing = state.drafts.get(existingId)!;
            if (existing.requestFingerprint !== fingerprint)
              throw new RequestError(409, -1007, "IDEMPOTENCY_KEY_CONFLICT");
            await finish(200);
            mockJson(response, 200, {
              media_id: existing.mediaId,
              mediaId: existing.mediaId,
              duplicate: true,
            });
            return;
          }
        }
        const mediaId = `mock-draft-${randomUUID()}`;
        const draft: MockDraft = {
          mediaId,
          ...normalized,
          requestFingerprint: fingerprint,
          createdAt: new Date().toISOString(),
        };
        state.drafts.set(mediaId, draft);
        if (draft.idempotencyKey)
          state.idempotency.set(draft.idempotencyKey, mediaId);
        if (fault === "created_but_response_lost") {
          await finish(599);
          response.destroy();
          return;
        }
        await finish(200);
        mockJson(response, 200, { media_id: mediaId, mediaId });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/v1/drafts") {
        const operationId = requestUrl.searchParams.get("operation_id");
        const planHash = requestUrl.searchParams.get("plan_hash");
        const fingerprint = requestUrl.searchParams.get("fingerprint");
        const idempotencyKey = requestUrl.searchParams.get("idempotency_key");
        const items = [...state.drafts.values()].filter(
          (draft) =>
            (!operationId || draft.operationId === operationId) &&
            (!planHash || draft.planHash === planHash) &&
            (!fingerprint || draft.requestFingerprint === fingerprint) &&
            (!idempotencyKey || draft.idempotencyKey === idempotencyKey),
        );
        await finish(200);
        mockJson(response, 200, {
          total_count: items.length,
          item_count: items.length,
          item: items.map(draftResponse),
        });
        return;
      }

      const draftMatch = requestUrl.pathname.match(/^\/v1\/drafts\/([^/]+)$/);
      if (request.method === "GET" && draftMatch) {
        const draft = state.drafts.get(decodeURIComponent(draftMatch[1]));
        if (!draft) throw new RequestError(404, 40007, "DRAFT_NOT_FOUND");
        await finish(200);
        mockJson(response, 200, draftResponse(draft));
        return;
      }

      const previewMatch = requestUrl.pathname.match(
        /^\/v1\/drafts\/([^/]+)\/preview$/,
      );
      if (request.method === "GET" && previewMatch) {
        const draft = state.drafts.get(decodeURIComponent(previewMatch[1]));
        if (!draft) throw new RequestError(404, 40007, "DRAFT_NOT_FOUND");
        await finish(200);
        html(response, 200, renderDraftHtml(draft));
        return;
      }

      if (request.method === "DELETE") {
        await finish(405);
        errorJson(response, 405, 40500, "REMOTE_DELETE_NOT_SUPPORTED");
        return;
      }
      await finish(404);
      errorJson(response, 404, 40400, "NOT_FOUND");
    } catch (error) {
      const requestError =
        error instanceof RequestError
          ? error
          : new RequestError(400, 40000, "INVALID_REQUEST");
      await finish(requestError.status);
      errorJson(
        response,
        requestError.status,
        requestError.code,
        requestError.message,
      );
    }
  });

  await persist(state, dataDir);
  let address: ReturnType<Server["address"]> = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port ?? 0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    address = server.address();
    if (
      options.port !== undefined ||
      !address ||
      typeof address === "string" ||
      !FETCH_BLOCKED_PORTS.has(address.port)
    )
      break;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
  if (!address || typeof address === "string")
    throw new Error("MOCK_SERVER_ADDRESS_UNAVAILABLE");
  if (FETCH_BLOCKED_PORTS.has(address.port)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("MOCK_SERVER_SAFE_PORT_UNAVAILABLE");
  }
  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
    state,
    dataDir,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

if (process.argv[1]?.endsWith("server.js")) {
  const dataDir = process.env.MPFORGE_MOCK_DATA_DIR;
  if (!dataDir) throw new Error("MPFORGE_MOCK_DATA_DIR_REQUIRED");
  startMockWechatServer({
    port: Number(process.env.MPFORGE_MOCK_PORT ?? 8787),
    dataDir,
    projectRoot: process.cwd(),
  }).then(({ url }) => console.log(`MPForge Mock WeChat listening at ${url}`));
}
