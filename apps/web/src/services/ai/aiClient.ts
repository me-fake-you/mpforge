// OpenAI 兼容 chat completions 流式客户端
// 预设端点均放行浏览器直连，故不经后端代理；自建/中转端点常缺 CORS 头，需单独识别

import {
  buildProviderExtras,
  type AiConfig,
  resolveChatCompletionsUrl,
} from "./aiConfig";

export type AiErrorKind =
  | "offline"
  | "network"
  | "auth"
  | "rate_limit"
  | "bad_request"
  | "server"
  | "aborted"
  | "timeout"
  | "malformed";

export class AiRequestError extends Error {
  readonly kind: AiErrorKind;
  readonly status?: number;

  constructor(kind: AiErrorKind, message: string, status?: number) {
    super(message);
    this.name = "AiRequestError";
    this.kind = kind;
    this.status = status;
  }
}

export interface AiMessage {
  role: "system" | "user";
  content: string;
}

export interface StreamChatOptions {
  config: AiConfig;
  messages: AiMessage[];
  signal?: AbortSignal;
  temperature?: number;
  onDelta?: (delta: string) => void;
  /** 推理模型的思考增量，仅用于展示进度，不计入结果 */
  onReasoning?: (delta: string) => void;
  fetchImpl?: typeof fetch;
}

const DEFAULT_TEMPERATURE = 0.3;

// 首个分片迟迟不来通常不是"慢"，而是连接挂住或服务商没按流式返回
const STREAM_STALL_MS = 45000;

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "AbortError" || error.code === DOMException.ABORT_ERR)
  );
}

function describeHttpFailure(status: number, body: string): AiRequestError {
  const detail = extractErrorMessage(body);
  const suffix = detail ? `（${detail}）` : "";

  if (status === 401 || status === 403) {
    return new AiRequestError(
      "auth",
      `API Key 无效或没有权限，请在「AI 优化」设置中更新${suffix}`,
      status,
    );
  }
  if (status === 429) {
    return new AiRequestError(
      "rate_limit",
      `请求过于频繁或额度不足，请稍后重试，并确认服务商账户余额${suffix}`,
      status,
    );
  }
  if (status >= 500) {
    return new AiRequestError(
      "server",
      `模型服务暂时不可用（HTTP ${status}），请稍后重试${suffix}`,
      status,
    );
  }
  return new AiRequestError(
    "bad_request",
    `请求被拒绝（HTTP ${status}），通常是模型名称不正确，请在「AI 优化」设置中确认${suffix}`,
    status,
  );
}

function extractErrorMessage(body: string): string {
  if (!body) return "";
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string };
      message?: string;
    };
    return parsed.error?.message ?? parsed.message ?? "";
  } catch {
    return body.slice(0, 120);
  }
}

// TypeError 无 status：可能断网，也可能端点未开 CORS，两者下一步动作不同
function describeNetworkFailure(): AiRequestError {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return new AiRequestError(
      "offline",
      "当前网络不可用，请检查网络连接后重试",
    );
  }
  return new AiRequestError(
    "network",
    "无法连接到模型服务。请确认 Base URL 填写正确；若使用自建或中转接口，还需该接口允许浏览器跨域调用（CORS）",
  );
}

function describeStall(): AiRequestError {
  return new AiRequestError(
    "timeout",
    `模型服务超过 ${Math.round(STREAM_STALL_MS / 1000)} 秒没有返回内容。可能是该服务商未真正流式返回，或所选模型响应过慢，可在设置中换一个更快的模型再试`,
  );
}

interface StreamDelta {
  content?: string;
  reasoning?: string;
}

function parseStreamLine(line: string): StreamDelta | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(":")) return null;
  if (!trimmed.startsWith("data:")) return null;

  const payload = trimmed.slice(5).trim();
  if (!payload || payload === "[DONE]") return null;

  try {
    const parsed = JSON.parse(payload) as {
      choices?: {
        delta?: {
          content?: string;
          reasoning_content?: string;
          reasoning_details?: { text?: string }[];
        };
      }[];
    };
    const delta = parsed.choices?.[0]?.delta;
    if (!delta) return null;

    // 推理模型先吐 reasoning_content，正文要等思考结束才来。
    // 不展示就是几十秒白屏，但它不是正文，不能计入结果。
    return {
      content: delta.content ?? undefined,
      reasoning:
        delta.reasoning_content ??
        delta.reasoning_details?.map((d) => d.text ?? "").join("") ??
        undefined,
    };
  } catch {
    // 跳过心跳与非标准行，不中断整体流
    return null;
  }
}

export function resolveModelsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  return `${trimmed.replace(/\/chat\/completions$/, "")}/models`;
}

// 名字兜底：不提供 output_modalities 的服务商只能按 id 判断
const NON_CHAT_TOKENS = [
  // 向量与重排
  "embed",
  "embedding",
  "embeddings",
  "bge",
  "gte",
  "m3e",
  "rerank",
  "reranker",
  // 语音
  "whisper",
  "tts",
  "asr",
  "audio",
  "speech",
  "voice",
  "sensevoice",
  "cosyvoice",
  "funasr",
  "paraformer",
  // 图像与视频
  "image",
  "ocr",
  "dall-?e",
  "flux",
  "kolors",
  "stable-?diffusion",
  "sdxl",
  "video",
  // 其他非对话用途
  "moderation",
  "guard",
];

const NON_CHAT_PATTERN = new RegExp(
  `(^|[-/_])(${NON_CHAT_TOKENS.join("|")})([-/_]|$)`,
  "i",
);

/**
 * 先补上分隔符再按整段匹配：SenseVoiceSmall、OCR2_0 这类驼峰与版本号后缀
 * 不补分隔符就匹配不到，直接用子串匹配又会误伤正常名字。
 */
function normalizeModelId(id: string): string {
  return id
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Za-z])(\d)/g, "$1-$2");
}

export function isChatModel(item: {
  id?: unknown;
  architecture?: { output_modalities?: unknown };
}): boolean {
  const id = typeof item?.id === "string" ? item.id : "";
  if (!id) return false;

  // 有声明就以声明为准：输出恰好只有 text 才是对话模型
  const modalities = item.architecture?.output_modalities;
  if (Array.isArray(modalities)) {
    return modalities.length === 1 && modalities[0] === "text";
  }

  return !NON_CHAT_PATTERN.test(normalizeModelId(id));
}

export interface FetchModelsOptions {
  config: AiConfig;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

// 不是所有兼容端点都实现了 /models，失败沿用同一套分类，由调用方决定要不要提示
export async function fetchModels(
  options: FetchModelsOptions,
): Promise<string[]> {
  const { config, signal, fetchImpl = fetch } = options;

  let response: Response;
  try {
    response = await fetchImpl(resolveModelsUrl(config.baseUrl), {
      method: "GET",
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal,
    });
  } catch (error) {
    if (isAbortError(error)) throw new AiRequestError("aborted", "已取消");
    throw describeNetworkFailure();
  }

  if (!response.ok) {
    let body = "";
    try {
      body = await response.text();
    } catch {
      body = "";
    }
    throw describeHttpFailure(response.status, body);
  }

  let payload: {
    data?: { id?: unknown; architecture?: { output_modalities?: unknown } }[];
  };
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    throw new AiRequestError("malformed", "模型列表格式无法解析");
  }

  const ids = (payload.data ?? [])
    .filter(isChatModel)
    .map((item) => (typeof item?.id === "string" ? item.id : ""))
    .filter(Boolean);

  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

export interface TestConnectionOptions {
  config: AiConfig;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export interface ConnectionProbe {
  /** 首个分片到达耗时，毫秒 */
  firstTokenMs: number;
}

/** 首字超过这个时间，实际使用会明显卡顿 */
export const SLOW_FIRST_TOKEN_MS = 8000;

/**
 * 走真实的流式路径并计首字延迟。
 * 只发一次非流式的 max_tokens=1 只能证明鉴权通过，对排队与吞吐一无所知，
 * 会出现"测试成功但改写一直转圈"。
 */
export async function testConnection(
  options: TestConnectionOptions,
): Promise<ConnectionProbe> {
  const { config, signal, fetchImpl = fetch } = options;
  const startedAt = Date.now();

  const messages: AiMessage[] = [{ role: "user", content: "回答一个字：好" }];

  let firstTokenMs = 0;
  await streamChatCompletion({
    config,
    messages,
    signal,
    fetchImpl,
    temperature: 0,
    onDelta: () => {
      if (!firstTokenMs) firstTokenMs = Date.now() - startedAt;
    },
  });

  return { firstTokenMs: firstTokenMs || Date.now() - startedAt };
}

export async function streamChatCompletion(
  options: StreamChatOptions,
): Promise<string> {
  const {
    config,
    messages,
    signal,
    temperature = DEFAULT_TEMPERATURE,
    onDelta,
    onReasoning,
    fetchImpl = fetch,
  } = options;

  const url = resolveChatCompletionsUrl(config.baseUrl);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature,
        stream: true,
        ...buildProviderExtras(config),
      }),
      signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new AiRequestError("aborted", "已取消");
    }
    throw describeNetworkFailure();
  }

  if (!response.ok) {
    let body = "";
    try {
      body = await response.text();
    } catch {
      body = "";
    }
    throw describeHttpFailure(response.status, body);
  }

  if (!response.body) {
    throw new AiRequestError("malformed", "模型服务未返回流式内容，请稍后重试");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result = "";

  let stalled = false;
  const onStall = () => {
    stalled = true;
    void reader.cancel().catch(() => {});
  };
  let stallTimer = setTimeout(onStall, STREAM_STALL_MS);
  const keepAlive = () => {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(onStall, STREAM_STALL_MS);
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      keepAlive();

      buffer += decoder.decode(value, { stream: true });

      // 分块可能在行中间截断，保留末尾不完整的行
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const delta = parseStreamLine(line);
        if (!delta) continue;
        if (delta.reasoning) onReasoning?.(delta.reasoning);
        if (delta.content) {
          result += delta.content;
          onDelta?.(delta.content);
        }
      }
    }

    const tail = parseStreamLine(buffer);
    if (tail?.reasoning) onReasoning?.(tail.reasoning);
    if (tail?.content) {
      result += tail.content;
      onDelta?.(tail.content);
    }
  } catch (error) {
    if (stalled) throw describeStall();
    if (isAbortError(error)) {
      throw new AiRequestError("aborted", "已取消");
    }
    throw describeNetworkFailure();
  } finally {
    clearTimeout(stallTimer);
    reader.releaseLock?.();
  }

  if (stalled) throw describeStall();

  if (!result.trim()) {
    throw new AiRequestError("malformed", "模型没有返回可用内容，请重试");
  }

  return result;
}
