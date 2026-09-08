import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { startMockWechatServer, type MockFault } from "@mpforge/mock-wechat";
import {
  beginDraftExecution,
  cancelDraftOperation,
  listDraftOperationIds,
  prepareDraftOperation,
  readEvents,
  readPlan,
  readStatus,
  reconcileDraftOperation,
  recordDraftExecutionOutcome,
  recordDraftRemoteAsset,
  verifyDraftReceipt,
  verifyPreparedOperation,
  type DraftOperationMode,
  type DraftOperationPlan,
  type ExecutionSnapshot,
  type OperationReceipt,
  type RemoteAssetRecord,
} from "@mpforge/draft-operations";
import {
  FileChallengeStore,
  captureCurrentCliExecutionContext,
  consumeHumanSideEffectApproval,
  prepareHumanSideEffectApproval,
} from "@mpforge/side-effect-gate";
import {
  MockProvider,
  ProviderError,
  RealDraftProvider,
  type DraftArticleInput,
  type WeChatDraftProvider,
} from "@mpforge/wechat-adapter";
import { readServerCredentials, showAccountConfiguration } from "./accounts.js";

export const ADAPTER_VERSION = "mpforge-wechat-adapter/0.1.0";
export const PLATFORM_CONTRACT_VERSION = "wechat-draft/2026-09-01";

interface JsonObject {
  [key: string]: unknown;
}

interface SnapshotAsset {
  asset_id: string;
  original_reference: string;
  local_path: string;
  normalized_path?: string;
  mime_type: string;
  sha256: string;
  transformations?: Array<{
    output_path?: string;
    output_sha256?: string;
    mime_type?: string;
  }>;
  build_outputs?: Array<{
    path?: string;
    sha256?: string;
    mime_type?: string;
  }>;
}

interface UploadSource {
  asset: SnapshotAsset;
  relativePath: string;
  contentHash: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface ExecuteDraftOptions {
  fault?: MockFault;
  now?: string;
  provider?: WeChatDraftProvider;
}

function operationDirectory(root: string, operationId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(operationId))
    throw new Error("INVALID_OPERATION_ID");
  return path.join(root, "operations", operationId);
}

function parseJson<T>(bytes: Uint8Array | string, label: string): T {
  try {
    return JSON.parse(
      typeof bytes === "string" ? bytes : Buffer.from(bytes).toString("utf8"),
    ) as T;
  } catch {
    throw new Error(`SNAPSHOT_JSON_INVALID: ${label}`);
  }
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function frontmatterString(source: string, key: string): string | undefined {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(source)?.[1];
  const match = block
    ? new RegExp(`^${key}:\\s*(.+?)\\s*$`, "mu").exec(block)
    : null;
  if (!match) return undefined;
  const value = match[1].replace(/^['"]|['"]$/gu, "").trim();
  return value === "null" ? undefined : value;
}

async function articleDirectoryForId(
  root: string,
  articleId: string,
): Promise<string> {
  const contentRoot = path.join(root, "content");
  for (const entry of await readdir(contentRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(contentRoot, entry.name);
    const source = await readFile(
      path.join(directory, "article.md"),
      "utf8",
    ).catch(() => "");
    if (frontmatterString(source, "id") === articleId) return directory;
  }
  throw new Error(`ARTICLE_NOT_FOUND_FOR_OPERATION: ${articleId}`);
}

async function activeApprovalSourceCommit(
  articleDirectory: string,
): Promise<string> {
  const approvalLines = (
    await readFile(
      path.join(articleDirectory, "history", "approvals.jsonl"),
      "utf8",
    )
  )
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => parseJson<JsonObject>(line, "approvals.jsonl"));
  const invalidationLines = await readFile(
    path.join(articleDirectory, "history", "approval-invalidations.jsonl"),
    "utf8",
  ).catch(() => "");
  const invalidated = new Set(
    invalidationLines
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) =>
        String(
          parseJson<JsonObject>(line, "approval-invalidations.jsonl")
            .previous_approval_id ?? "",
        ),
      ),
  );
  const active = [...approvalLines]
    .reverse()
    .find((record) => !invalidated.has(String(record.approval_id ?? "")));
  if (!active || typeof active.source_commit !== "string")
    throw new Error("ACTIVE_APPROVAL_NOT_FOUND");
  return active.source_commit;
}

export async function prepareDraft(
  root: string,
  slug: string,
  input: { mode: DraftOperationMode; accountAlias?: string; now?: string },
) {
  const accountAlias =
    input.accountAlias ?? (input.mode === "mock" ? "local-mock" : "");
  if (!accountAlias) throw new Error("ACCOUNT_REQUIRED");
  const account = await showAccountConfiguration(root, accountAlias);
  if (!account.enabled) throw new Error("ACCOUNT_DISABLED");
  if (account.mode !== input.mode) throw new Error("ACCOUNT_MODE_MISMATCH");
  const articleDirectory = path.join(root, "content", slug);
  const sourceCommit = await activeApprovalSourceCommit(articleDirectory);
  return prepareDraftOperation({
    workspaceRoot: root,
    articleDirectory,
    accountAlias,
    provider: "wechat",
    mode: input.mode,
    sourceCommit,
    adapterVersion: ADAPTER_VERSION,
    platformContractVersion: PLATFORM_CONTRACT_VERSION,
    createdAt: input.now,
  });
}

function snapshotAssets(snapshot: ExecutionSnapshot): SnapshotAsset[] {
  const manifest = parseJson<{ assets?: SnapshotAsset[] }>(
    snapshot.files.get("assets-manifest.json")!,
    "assets-manifest.json",
  );
  if (!Array.isArray(manifest.assets))
    throw new Error("SNAPSHOT_ASSET_MANIFEST_INVALID");
  return manifest.assets;
}

function uploadSource(
  snapshot: ExecutionSnapshot,
  asset: SnapshotAsset,
): UploadSource {
  const candidates = [
    ...(asset.build_outputs ?? []).map((item) => ({
      path: item.path,
      sha256: item.sha256,
      mimeType: item.mime_type,
    })),
    ...(asset.transformations ?? []).map((item) => ({
      path: item.output_path,
      sha256: item.output_sha256,
      mimeType: item.mime_type,
    })),
    {
      path: asset.local_path,
      sha256: asset.sha256,
      mimeType: asset.mime_type,
    },
  ];
  for (const candidate of candidates) {
    if (
      !candidate.path ||
      !candidate.sha256 ||
      !["image/png", "image/jpeg"].includes(candidate.mimeType ?? "")
    )
      continue;
    const bytes = snapshot.files.get(candidate.path.replace(/\\/gu, "/"));
    if (!bytes || sha256(bytes) !== candidate.sha256) continue;
    return {
      asset,
      relativePath: candidate.path.replace(/\\/gu, "/"),
      contentHash: candidate.sha256,
      mimeType: candidate.mimeType!,
      bytes,
    };
  }
  throw new Error(`UPLOADABLE_IMAGE_REQUIRED: ${asset.asset_id}`);
}

function bodyUploadSources(snapshot: ExecutionSnapshot): UploadSource[] {
  const html = Buffer.from(snapshot.files.get("article.wechat.html")!).toString(
    "utf8",
  );
  const references = new Set(
    [...html.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/giu)].map(
      (match) => match[1],
    ),
  );
  return snapshotAssets(snapshot)
    .filter((asset) =>
      [
        asset.original_reference,
        asset.local_path,
        asset.normalized_path,
        ...(asset.build_outputs ?? []).map((item) => item.path),
        ...(asset.transformations ?? []).map((item) => item.output_path),
      ].some((candidate) => candidate && references.has(candidate)),
    )
    .map((asset) => uploadSource(snapshot, asset));
}

function replaceImageReferences(
  html: string,
  uploaded: Array<{ source: UploadSource; url: string }>,
): string {
  let result = html;
  for (const item of uploaded) {
    const references = [
      item.source.asset.original_reference,
      item.source.asset.local_path,
      item.source.asset.normalized_path,
      ...(item.source.asset.build_outputs ?? []).map((entry) => entry.path),
      ...(item.source.asset.transformations ?? []).map(
        (entry) => entry.output_path,
      ),
    ].filter((value): value is string => Boolean(value));
    for (const reference of references)
      result = result.split(reference).join(item.url);
  }
  return result;
}

function assertFinalPayloadSafe(html: string): void {
  if (/<script\b|\son\w+\s*=/iu.test(html))
    throw new Error("FINAL_PAYLOAD_UNSAFE_HTML");
  for (const match of html.matchAll(
    /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/giu,
  )) {
    if (!/^https?:\/\//iu.test(match[1]))
      throw new Error("FINAL_PAYLOAD_CONTAINS_LOCAL_IMAGE");
  }
}

function draftArticleInput(
  snapshot: ExecutionSnapshot,
  html: string,
  coverMediaId: string,
): DraftArticleInput {
  const source = Buffer.from(snapshot.files.get("article.md")!).toString(
    "utf8",
  );
  return {
    article_type: "news",
    title: snapshot.plan.title,
    author: frontmatterString(source, "author"),
    digest: frontmatterString(source, "summary"),
    content: html,
    thumb_media_id: coverMediaId,
    need_open_comment: 0,
    only_fans_can_comment: 0,
  };
}

async function createProvider(
  root: string,
  plan: DraftOperationPlan,
  options: ExecuteDraftOptions,
): Promise<{
  provider: WeChatDraftProvider;
  close: () => Promise<void>;
}> {
  if (options.provider)
    return { provider: options.provider, close: async () => undefined };
  if (plan.mode === "mock") {
    const server = await startMockWechatServer({
      port: 0,
      dataDir: path.join(root, "tmp", "mock-wechat", plan.account_alias),
      projectRoot: root,
      faultDelayMs: 150,
    });
    return {
      provider: new MockProvider({
        baseUrl: server.url,
        accountAlias: plan.account_alias,
        faultMode: () => options.fault,
      }),
      close: () => server.close(),
    };
  }
  const credentials = await readServerCredentials(root, plan.account_alias);
  return {
    provider: new RealDraftProvider({
      credentialProvider: async () => credentials ?? undefined,
    }),
    close: async () => undefined,
  };
}

async function executePreparedDraft(
  root: string,
  operationId: string,
  options: ExecuteDraftOptions = {},
): Promise<OperationReceipt> {
  const directory = operationDirectory(root, operationId);
  const plan = await readPlan(directory);
  const articleDirectory = await articleDirectoryForId(root, plan.article_id);
  const snapshot = await beginDraftExecution({
    workspaceRoot: root,
    operationId,
    currentAccountAlias: plan.account_alias,
    currentMode: plan.mode,
    currentArticleDirectory: articleDirectory,
    now: options.now,
  });
  const remoteAssets: RemoteAssetRecord[] = [];
  const service = await createProvider(root, plan, options);
  let sanitizedRequest: unknown = {};
  try {
    const configuration = await service.provider.validateConfiguration({
      accountAlias: plan.account_alias,
      coverMaterialType: "image",
    });
    if (!configuration.ok)
      throw new Error(
        `PROVIDER_CONFIGURATION_INVALID: ${configuration.errors.join(",")}`,
      );
    const token = await service.provider.obtainAccessToken();
    const bodySources = bodyUploadSources(snapshot);
    if (bodySources.length !== plan.body_image_count)
      throw new Error("BODY_IMAGE_COUNT_MISMATCH");
    const uploaded: Array<{ source: UploadSource; url: string }> = [];
    for (const source of bodySources) {
      const result = await service.provider.uploadBodyImage({
        relativePath: source.relativePath,
        contentHash: source.contentHash,
        mimeType: source.mimeType,
        bytes: source.bytes,
        accessToken: token.accessToken,
      });
      uploaded.push({ source, url: result.url });
      const remoteAsset: RemoteAssetRecord = {
        asset_id: source.asset.asset_id,
        kind: "body_image",
        remote_id: result.mediaId ?? null,
        remote_url: result.url,
        uploaded_at: new Date().toISOString(),
        safely_reusable: true,
      };
      remoteAssets.push(remoteAsset);
      await recordDraftRemoteAsset({
        workspaceRoot: root,
        operationId,
        asset: remoteAsset,
      });
    }
    const coverAsset = snapshotAssets(snapshot).find(
      (asset) => asset.asset_id === plan.cover_asset_id,
    );
    if (!coverAsset) throw new Error("COVER_ASSET_NOT_FOUND");
    const coverSource = uploadSource(snapshot, coverAsset);
    const cover = await service.provider.uploadCoverMaterial({
      relativePath: coverSource.relativePath,
      contentHash: coverSource.contentHash,
      mimeType: coverSource.mimeType,
      bytes: coverSource.bytes,
      accessToken: token.accessToken,
      materialType: "image",
    });
    const remoteCover: RemoteAssetRecord = {
      asset_id: coverAsset.asset_id,
      kind: "cover",
      remote_id: cover.mediaId,
      remote_url: cover.url ?? null,
      uploaded_at: new Date().toISOString(),
      safely_reusable: true,
    };
    remoteAssets.push(remoteCover);
    await recordDraftRemoteAsset({
      workspaceRoot: root,
      operationId,
      asset: remoteCover,
    });
    const originalHtml = Buffer.from(
      snapshot.files.get("article.wechat.html")!,
    ).toString("utf8");
    const remoteHtml = replaceImageReferences(originalHtml, uploaded);
    assertFinalPayloadSafe(remoteHtml);
    const request = {
      accessToken: token.accessToken,
      articles: [draftArticleInput(snapshot, remoteHtml, cover.mediaId)],
      idempotencyKey: plan.idempotency_key,
      operationId: plan.operation_id,
      planHash: plan.plan_hash,
    };
    sanitizedRequest = service.provider.sanitizeRequest(request);
    const result = await service.provider.createDraft(request);
    const verified = await service.provider.getDraft({
      accessToken: token.accessToken,
      mediaId: result.mediaId,
    });
    if (verified.mediaId !== result.mediaId)
      throw new Error("REMOTE_DRAFT_VERIFICATION_FAILED");
    const receipt = await recordDraftExecutionOutcome({
      workspaceRoot: root,
      operationId,
      status: "SUCCEEDED",
      remoteAssets,
      remoteDraftId: result.mediaId,
      request: sanitizedRequest,
      response: service.provider.sanitizeResponse(verified),
      verified: true,
    });
    if (plan.mode === "real") {
      const { transitionArticle } = await import("./cli.js");
      await transitionArticle(
        path.basename(articleDirectory),
        "sent_to_draft",
        {
          actorId: "mpforge-real-draft",
          reason: `Verified real draft operation ${operationId}`,
        },
        root,
      );
    }
    return receipt;
  } catch (error) {
    const uncertain =
      error instanceof ProviderError && error.uncertainSideEffect;
    const status = uncertain
      ? "UNKNOWN_REMOTE_STATE"
      : remoteAssets.length
        ? "FAILED_WITH_REMOTE_ASSETS"
        : "FAILED";
    return await recordDraftExecutionOutcome({
      workspaceRoot: root,
      operationId,
      status,
      remoteAssets,
      request: sanitizedRequest,
      response: {
        error_code:
          error instanceof ProviderError ? error.code : "LOCAL_FAILURE",
        error_message:
          error instanceof Error ? error.message : "Unknown failure",
      },
      errorCode:
        error instanceof ProviderError ? String(error.code) : "LOCAL_FAILURE",
    });
  } finally {
    await service.close();
  }
}

export async function executeDraft(
  root: string,
  operationId: string,
  options: ExecuteDraftOptions = {},
): Promise<OperationReceipt> {
  const plan = await readPlan(operationDirectory(root, operationId));
  if (plan.mode !== "mock")
    throw new Error(
      "REAL_DRAFT_HUMAN_GATE_REQUIRED: use the interactive real execution entry point",
    );
  return executePreparedDraft(root, operationId, options);
}

export async function executeRealDraftInteractive(
  root: string,
  operationId: string,
): Promise<OperationReceipt> {
  const plan = await readPlan(operationDirectory(root, operationId));
  if (plan.mode !== "real") throw new Error("REAL_OPERATION_REQUIRED");
  const articleDirectory = await articleDirectoryForId(root, plan.article_id);
  await verifyPreparedOperation({
    workspaceRoot: root,
    operationId,
    currentAccountAlias: plan.account_alias,
    currentMode: "real",
    currentArticleDirectory: articleDirectory,
  });
  const context = captureCurrentCliExecutionContext("real");
  const binding = {
    operation_id: plan.operation_id,
    account_alias: plan.account_alias,
    plan_hash: plan.plan_hash,
  };
  const store = new FileChallengeStore(
    path.join(root, "operations", operationId, ".side-effect-approval"),
  );
  const challenge = await prepareHumanSideEffectApproval(
    { binding, context },
    store,
  );
  process.stdout.write(
    `${JSON.stringify(
      {
        title: "创建微信公众号草稿",
        operation_id: plan.operation_id,
        account_alias: plan.account_alias,
        plan_hash: plan.plan_hash,
        expected_side_effects: plan.expected_side_effects,
        warnings: plan.warnings,
        confirmation_button: "确认创建公众号草稿",
        challenge_code: challenge.challenge_code,
        challenge_expires_at: challenge.expires_at,
      },
      null,
      2,
    )}\n`,
  );
  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  let submitted: string;
  try {
    submitted = await prompt.question(
      `输入绑定 ${plan.operation_id} / ${plan.account_alias} / ${plan.plan_hash} 的一次性挑战码：`,
    );
  } finally {
    prompt.close();
  }
  await consumeHumanSideEffectApproval(
    {
      binding,
      context,
      challenge_code: submitted.trim(),
      submitted_by: "human-tty",
    },
    store,
  );
  return executePreparedDraft(root, operationId);
}

export async function getDraftOperation(root: string, operationId: string) {
  const directory = operationDirectory(root, operationId);
  return {
    plan: await readPlan(directory),
    status: await readStatus(directory),
    events: await readEvents(directory),
  };
}

export async function listDraftOperations(root: string) {
  const ids = await listDraftOperationIds({ workspaceRoot: root });
  return Promise.all(
    ids.map(async (operationId) => {
      const operation = await getDraftOperation(root, operationId);
      return { operation_id: operationId, ...operation };
    }),
  );
}

export async function cancelDraft(root: string, operationId: string) {
  await cancelDraftOperation({ workspaceRoot: root, operationId });
  return getDraftOperation(root, operationId);
}

export async function getDraftOperationReceipt(
  root: string,
  operationId: string,
) {
  const status = await readStatus(operationDirectory(root, operationId));
  return verifyDraftReceipt({
    workspaceRoot: root,
    operationId,
    reconciliation: status.status.startsWith("RECONCILED_"),
  });
}

export async function reconcileDraft(
  root: string,
  operationId: string,
  options: { provider?: WeChatDraftProvider } = {},
) {
  const directory = operationDirectory(root, operationId);
  const plan = await readPlan(directory);
  const service = await createProvider(root, plan, {
    provider: options.provider,
  });
  try {
    const token = await service.provider.obtainAccessToken();
    const source = Buffer.from(
      await readFile(path.join(directory, "snapshot", "article.md")),
    ).toString("utf8");
    const possible = await service.provider.findPossibleDraft({
      accessToken: token.accessToken,
      title: plan.title,
      digest: frontmatterString(source, "summary"),
      maxPages: 5,
    });
    const result =
      possible.disposition === "ONE_CANDIDATE"
        ? "CONFIRMED_CREATED"
        : possible.disposition === "NONE"
          ? "CONFIRMED_NOT_CREATED"
          : "AMBIGUOUS";
    const receipt = await reconcileDraftOperation({
      workspaceRoot: root,
      operationId,
      result,
      remoteDraftId:
        possible.disposition === "ONE_CANDIDATE"
          ? possible.candidates[0].mediaId
          : undefined,
      response: service.provider.sanitizeResponse(possible),
    });
    return { result, receipt, possible };
  } finally {
    await service.close();
  }
}
