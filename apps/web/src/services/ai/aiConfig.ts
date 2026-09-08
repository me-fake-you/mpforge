export type AiProviderId =
  | "deepseek"
  | "zhipu"
  | "moonshot"
  | "qwen"
  | "siliconflow"
  | "openai"
  | "openrouter"
  | "custom";

export interface AiProviderPreset {
  id: AiProviderId;
  label: string;
  baseUrl: string;
  defaultModel: string;
  apiKeyUrl?: string;
  mark?: string;
}

/** 当前生效的配置，是把所选服务商的那份取出来后的结果 */
export interface AiConfig {
  enabled: boolean;
  provider: AiProviderId;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 作者的长期写作要求，拼进三个动作的提示词 */
  preference: string;
}

export interface AiProviderSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** 持久化形态：各服务商的 Key 与模型分开存，换服务商不会串到别家 */
interface AiConfigStore {
  enabled: boolean;
  provider: AiProviderId;
  /** 与服务商无关，存在顶层：换服务商不该丢掉写作偏好 */
  preference: string;
  providers: Partial<Record<AiProviderId, Partial<AiProviderSettings>>>;
}

// 端点均已实测放行浏览器跨域（含 Electron file:// 的 Origin: null）
const NETWORK_PROVIDER_PRESETS: AiProviderPreset[] = [
  {
    id: "deepseek",
    label: "DeepSeek",
    mark: "DS",
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-v4-flash",
    apiKeyUrl: "https://platform.deepseek.com/api_keys",
  },
  {
    id: "zhipu",
    label: "智谱",
    mark: "智",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4-flash",
    apiKeyUrl: "https://open.bigmodel.cn/usercenter/apikeys",
  },
  {
    id: "moonshot",
    label: "Kimi",
    mark: "K",
    baseUrl: "https://api.moonshot.cn/v1",
    defaultModel: "moonshot-v1-8k",
    apiKeyUrl: "https://platform.moonshot.cn/console/api-keys",
  },
  {
    id: "qwen",
    label: "通义千问",
    mark: "通",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus",
    apiKeyUrl: "https://bailian.console.aliyun.com/?tab=model#/api-key",
  },
  {
    id: "siliconflow",
    label: "硅基流动",
    mark: "硅",
    baseUrl: "https://api.siliconflow.cn/v1",
    defaultModel: "Qwen/Qwen2.5-7B-Instruct",
    apiKeyUrl: "https://cloud.siliconflow.cn/account/ak",
  },
  {
    id: "openai",
    label: "OpenAI",
    mark: "AI",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    apiKeyUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    mark: "OR",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "deepseek/deepseek-v4-flash",
    apiKeyUrl: "https://openrouter.ai/keys",
  },
  {
    id: "custom",
    label: "自定义",
    baseUrl: "",
    defaultModel: "",
  },
];

export const AI_PROVIDER_PRESETS: AiProviderPreset[] = __MPFORGE_DEMO_MODE__
  ? [
      {
        id: "custom",
        label: "Demo 中已禁用外部 AI",
        baseUrl: "",
        defaultModel: "",
      },
    ]
  : NETWORK_PROVIDER_PRESETS;

import { MAX_PREFERENCE_CHARS } from "./aiPrompts";

export { MAX_PREFERENCE_CHARS };

export const AI_CONFIG_STORAGE_KEY = "wemd-ai-config";
export const AI_CONFIG_EVENT = "wemd-ai-config-change";
export const AI_SETTINGS_OPEN_EVENT = "wemd-open-ai-settings";

export function getProviderPreset(id: AiProviderId): AiProviderPreset {
  return (
    AI_PROVIDER_PRESETS.find((preset) => preset.id === id) ??
    AI_PROVIDER_PRESETS[0]
  );
}

const DEFAULT_PRESET = AI_PROVIDER_PRESETS[0];

export const DEFAULT_AI_CONFIG: AiConfig = {
  enabled: false,
  provider: DEFAULT_PRESET.id,
  baseUrl: DEFAULT_PRESET.baseUrl,
  apiKey: "",
  model: DEFAULT_PRESET.defaultModel,
  preference: "",
};

const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

function normalizeStore(raw: unknown): AiConfigStore {
  const empty: AiConfigStore = {
    enabled: false,
    provider: DEFAULT_AI_CONFIG.provider,
    preference: "",
    providers: {},
  };
  if (!raw || typeof raw !== "object") return empty;

  const source = raw as Partial<AiConfigStore> & Partial<AiProviderSettings>;
  const provider = AI_PROVIDER_PRESETS.some((p) => p.id === source.provider)
    ? (source.provider as AiProviderId)
    : DEFAULT_AI_CONFIG.provider;

  const providers: AiConfigStore["providers"] = {};
  const stored = source.providers;
  if (stored && typeof stored === "object") {
    for (const preset of AI_PROVIDER_PRESETS) {
      const entry = stored[preset.id];
      if (!entry || typeof entry !== "object") continue;
      providers[preset.id] = {
        baseUrl: text(entry.baseUrl),
        apiKey: text(entry.apiKey),
        model: text(entry.model),
      };
    }
  }

  // 旧版把 Key 平铺存在顶层，迁移到当前服务商名下
  if (!stored && (source.apiKey || source.model || source.baseUrl)) {
    providers[provider] = {
      baseUrl: text(source.baseUrl),
      apiKey: text(source.apiKey),
      model: text(source.model),
    };
  }

  return {
    enabled: source.enabled === true,
    provider,
    preference: text(source.preference),
    providers,
  };
}

function readStore(): AiConfigStore {
  if (typeof window === "undefined") return normalizeStore(null);

  const stored = window.localStorage.getItem(AI_CONFIG_STORAGE_KEY);
  if (!stored) return normalizeStore(null);

  try {
    return normalizeStore(JSON.parse(stored));
  } catch {
    return normalizeStore(null);
  }
}

function resolve(store: AiConfigStore): AiConfig {
  const preset = getProviderPreset(store.provider);
  const entry = store.providers[store.provider] ?? {};
  return {
    enabled: store.enabled,
    provider: store.provider,
    baseUrl: entry.baseUrl || preset.baseUrl,
    apiKey: entry.apiKey || "",
    model: entry.model || preset.defaultModel,
    preference: store.preference,
  };
}

export function getAiConfig(): AiConfig {
  return resolve(readStore());
}

/** 读取某个服务商已保存的配置，用于切换服务商时取回它自己的 Key */
export function getProviderConfig(provider: AiProviderId): AiConfig {
  const store = readStore();
  return resolve({ ...store, provider });
}

export function setAiConfig(config: AiConfig): void {
  if (typeof window === "undefined") return;

  const store = readStore();
  const next: AiConfigStore = {
    enabled: config.enabled,
    provider: config.provider,
    preference: text(config.preference).slice(0, MAX_PREFERENCE_CHARS),
    providers: {
      ...store.providers,
      [config.provider]: {
        baseUrl: text(config.baseUrl),
        apiKey: text(config.apiKey),
        model: text(config.model),
      },
    },
  };

  window.localStorage.setItem(AI_CONFIG_STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(
    new CustomEvent<AiConfig>(AI_CONFIG_EVENT, { detail: resolve(next) }),
  );
}

export function subscribeAiConfig(
  listener: (config: AiConfig) => void,
): () => void {
  if (typeof window === "undefined") return () => {};

  const handle = (event: Event) => {
    listener((event as CustomEvent<AiConfig>).detail);
  };
  window.addEventListener(AI_CONFIG_EVENT, handle);
  return () => window.removeEventListener(AI_CONFIG_EVENT, handle);
}

export function requestOpenAiSettings(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(AI_SETTINGS_OPEN_EVENT));
}

/**
 * 关闭思考的参数各家不同，且部分模型传了会直接报错，必须按模型细分：
 * - Kimi 的 moonshot-v1 系列不支持思考，k2.7-code 强制思考，传 disabled 会报错
 * - OpenAI 只有 gpt-5.1 及以上的推理模型接受 reasoning_effort: "none"
 */
function disableThinkingParams(config: AiConfig): Record<string, unknown> {
  const model = config.model.toLowerCase();

  switch (config.provider) {
    case "deepseek":
    case "zhipu":
      return { thinking: { type: "disabled" } };

    // 阿里云文档明确：不支持该参数的模型收到也不报错
    case "siliconflow":
    case "qwen":
      return { enable_thinking: false };

    // effort:"none" 在 mandatory 推理模型上会出错，exclude 各模型都安全
    case "openrouter":
      return { reasoning: { exclude: true } };

    case "moonshot":
      return /^kimi-k2\.(5|6)/.test(model)
        ? { thinking: { type: "disabled" } }
        : {};

    case "openai":
      return /^gpt-5\.[1-9]/.test(model) ? { reasoning_effort: "none" } : {};

    default:
      return {};
  }
}

// 改写、审阅、起标题都不需要思维链，一律关掉；关不掉的模型由界面显示思考进度兜底
export function buildProviderExtras(config: AiConfig): Record<string, unknown> {
  return disableThinkingParams(config);
}

export function isAiConfigComplete(config: AiConfig): boolean {
  return Boolean(config.apiKey && config.baseUrl && config.model);
}

export function isAiRewriteReady(config: AiConfig = getAiConfig()): boolean {
  return config.enabled && isAiConfigComplete(config);
}

// 用户可能填 Base URL、带尾斜杠，或直接粘完整端点
export function resolveChatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  return `${trimmed}/chat/completions`;
}
