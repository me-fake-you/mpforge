import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AI_CONFIG_STORAGE_KEY,
  buildProviderExtras,
  getProviderConfig,
  AI_PROVIDER_PRESETS,
  DEFAULT_AI_CONFIG,
  getAiConfig,
  getProviderPreset,
  isAiConfigComplete,
  isAiRewriteReady,
  resolveChatCompletionsUrl,
  setAiConfig,
  subscribeAiConfig,
  type AiConfig,
} from "../../services/ai/aiConfig";

const completeConfig: AiConfig = {
  enabled: true,
  provider: "deepseek",
  baseUrl: "https://api.deepseek.com/v1",
  apiKey: "sk-test",
  model: "deepseek-chat",
  preference: "",
};

describe("aiConfig 读写", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        values.set(key, String(value));
      }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("无存储时返回默认配置且默认关闭", () => {
    expect(getAiConfig()).toEqual(DEFAULT_AI_CONFIG);
    expect(getAiConfig().enabled).toBe(false);
  });

  it("存储内容损坏时回落到默认配置", () => {
    localStorage.setItem(AI_CONFIG_STORAGE_KEY, "{ not json");
    expect(getAiConfig()).toEqual(DEFAULT_AI_CONFIG);
  });

  it("未知服务商回落到默认服务商及其 Base URL", () => {
    localStorage.setItem(
      AI_CONFIG_STORAGE_KEY,
      JSON.stringify({ provider: "unknown-vendor", apiKey: "sk-x" }),
    );

    const config = getAiConfig();
    expect(config.provider).toBe(DEFAULT_AI_CONFIG.provider);
    expect(config.baseUrl).toBe(DEFAULT_AI_CONFIG.baseUrl);
    expect(config.model).toBe(DEFAULT_AI_CONFIG.model);
  });

  it("保存后可读回，并去除首尾空白", () => {
    setAiConfig({ ...completeConfig, apiKey: "  sk-spaced  " });
    expect(getAiConfig().apiKey).toBe("sk-spaced");
  });

  it("保存时通知订阅者，取消订阅后不再收到", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAiConfig(listener);

    setAiConfig(completeConfig);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].apiKey).toBe("sk-test");

    unsubscribe();
    setAiConfig({ ...completeConfig, model: "deepseek-reasoner" });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("就绪判断", () => {
  it("缺少任一必填项都视为未填全", () => {
    expect(isAiConfigComplete(completeConfig)).toBe(true);
    expect(isAiConfigComplete({ ...completeConfig, apiKey: "" })).toBe(false);
    expect(isAiConfigComplete({ ...completeConfig, model: "" })).toBe(false);
    expect(isAiConfigComplete({ ...completeConfig, baseUrl: "" })).toBe(false);
  });

  it("关闭启用开关时不就绪，但配置本身仍然完整", () => {
    const disabled = { ...completeConfig, enabled: false };
    expect(isAiRewriteReady(disabled)).toBe(false);
    expect(isAiConfigComplete(disabled)).toBe(true);
  });

  it("填全且启用才就绪", () => {
    expect(isAiRewriteReady(completeConfig)).toBe(true);
  });
});

describe("服务商预设", () => {
  const presets = AI_PROVIDER_PRESETS.filter((p) => p.id !== "custom");

  it("自定义排在最后，其余预设都填全了必要字段", () => {
    expect(AI_PROVIDER_PRESETS.at(-1)?.id).toBe("custom");
    for (const preset of presets) {
      expect(preset.baseUrl, preset.label).toMatch(/^https:\/\//);
      expect(preset.defaultModel, preset.label).not.toBe("");
      expect(preset.apiKeyUrl, preset.label).toMatch(/^https:\/\//);
    }
  });

  it("预设 Base URL 都能拼出合法的 chat/completions 端点", () => {
    for (const preset of presets) {
      const url = resolveChatCompletionsUrl(preset.baseUrl);
      expect(url, preset.label).toMatch(/\/chat\/completions$/);
      expect(() => new URL(url), preset.label).not.toThrow();
    }
  });

  it("服务商 id 不重复", () => {
    const ids = AI_PROVIDER_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("切换服务商时按预设回填 Base URL 与模型", () => {
    const preset = getProviderPreset("moonshot");
    expect(preset.baseUrl).toBe("https://api.moonshot.cn/v1");
    expect(getProviderPreset("custom").baseUrl).toBe("");
  });
});

describe("各服务商配置互相隔离", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, String(value)),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("换服务商不会把上一家的 Key 带过去", () => {
    setAiConfig({ ...completeConfig, provider: "deepseek", apiKey: "sk-ds" });
    const moonshot = getProviderConfig("moonshot");

    expect(moonshot.apiKey).toBe("");
    expect(moonshot.baseUrl).toBe(getProviderPreset("moonshot").baseUrl);
    expect(moonshot.model).toBe(getProviderPreset("moonshot").defaultModel);
  });

  it("各自的 Key 分别保存，来回切换都能取回", () => {
    setAiConfig({ ...completeConfig, provider: "deepseek", apiKey: "sk-ds" });
    setAiConfig({
      ...completeConfig,
      provider: "moonshot",
      apiKey: "sk-kimi",
      model: "moonshot-v1-8k",
    });

    expect(getProviderConfig("deepseek").apiKey).toBe("sk-ds");
    expect(getProviderConfig("moonshot").apiKey).toBe("sk-kimi");
    expect(getAiConfig().provider).toBe("moonshot");
  });

  it("旧版平铺存储迁移到当前服务商名下，不丢 Key", () => {
    localStorage.setItem(
      AI_CONFIG_STORAGE_KEY,
      JSON.stringify({
        enabled: true,
        provider: "zhipu",
        apiKey: "sk-old",
        model: "glm-4-flash",
        baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      }),
    );

    expect(getAiConfig().apiKey).toBe("sk-old");
    expect(getProviderConfig("zhipu").apiKey).toBe("sk-old");
    expect(getProviderConfig("deepseek").apiKey).toBe("");
  });
});

describe("服务商专属参数", () => {
  it("DeepSeek 关闭思考模式，否则流式先吐 reasoning_content 导致长时间空白", () => {
    expect(buildProviderExtras(completeConfig)).toEqual({
      thinking: { type: "disabled" },
    });
  });

  it("硅基流动用 enable_thinking，与 DeepSeek 官方的参数名不同", () => {
    expect(
      buildProviderExtras({ ...completeConfig, provider: "siliconflow" }),
    ).toEqual({ enable_thinking: false });
  });

  it("智谱与 DeepSeek 同为 thinking.type=disabled", () => {
    expect(
      buildProviderExtras({
        ...completeConfig,
        provider: "zhipu",
        model: "glm-4.7",
      }),
    ).toEqual({ thinking: { type: "disabled" } });
  });

  it("Kimi 按模型细分：k2.5/k2.6 可关，其余不下发", () => {
    const kimi = (model: string) =>
      buildProviderExtras({ ...completeConfig, provider: "moonshot", model });

    expect(kimi("kimi-k2.6")).toEqual({ thinking: { type: "disabled" } });
    expect(kimi("kimi-k2.5-turbo")).toEqual({ thinking: { type: "disabled" } });
    expect(kimi("moonshot-v1-8k")).toEqual({});
    expect(kimi("kimi-k2.7-code")).toEqual({});
    expect(kimi("kimi-k3")).toEqual({});
  });

  it("OpenAI 只对 gpt-5.1 及以上下发 reasoning_effort=none", () => {
    const openai = (model: string) =>
      buildProviderExtras({ ...completeConfig, provider: "openai", model });

    expect(openai("gpt-5.2")).toEqual({ reasoning_effort: "none" });
    expect(openai("gpt-4o-mini")).toEqual({});
    expect(openai("o3-mini")).toEqual({});
  });

  it("通义千问复用 enable_thinking，OpenRouter 用 reasoning.exclude", () => {
    expect(
      buildProviderExtras({ ...completeConfig, provider: "qwen" }),
    ).toEqual({ enable_thinking: false });
    expect(
      buildProviderExtras({ ...completeConfig, provider: "openrouter" }),
    ).toEqual({ reasoning: { exclude: true } });
  });

  it("自定义端点不下发任何专属参数", () => {
    expect(
      buildProviderExtras({ ...completeConfig, provider: "custom" }),
    ).toEqual({});
  });
});

describe("写作偏好存储", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, String(value)),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("换服务商不会丢掉写作偏好", () => {
    setAiConfig({ ...completeConfig, preference: "不要口语化" });
    expect(getProviderConfig("moonshot").preference).toBe("不要口语化");
    expect(getProviderConfig("openai").preference).toBe("不要口语化");
  });

  it("超长偏好在落盘时就截断", () => {
    setAiConfig({ ...completeConfig, preference: "字".repeat(400) });
    expect(getAiConfig().preference).toHaveLength(200);
  });

  it("旧版存储没有该字段时回落为空串", () => {
    localStorage.setItem(
      AI_CONFIG_STORAGE_KEY,
      JSON.stringify({ enabled: true, provider: "deepseek", apiKey: "sk-x" }),
    );
    expect(getAiConfig().preference).toBe("");
  });
});

describe("端点归一化", () => {
  it("补全 chat/completions 路径", () => {
    expect(resolveChatCompletionsUrl("https://api.deepseek.com/v1")).toBe(
      "https://api.deepseek.com/v1/chat/completions",
    );
  });

  it("忽略尾部斜杠", () => {
    expect(resolveChatCompletionsUrl("https://api.deepseek.com/v1///")).toBe(
      "https://api.deepseek.com/v1/chat/completions",
    );
  });

  it("用户直接粘完整端点时不重复拼接", () => {
    const full = "https://api.deepseek.com/v1/chat/completions";
    expect(resolveChatCompletionsUrl(full)).toBe(full);
  });
});
