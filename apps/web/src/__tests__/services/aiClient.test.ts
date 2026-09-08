import { describe, expect, it, vi } from "vitest";

import {
  AiRequestError,
  isChatModel,
  streamChatCompletion,
  testConnection,
  type AiMessage,
} from "../../services/ai/aiClient";
import type { AiConfig } from "../../services/ai/aiConfig";

const config: AiConfig = {
  enabled: true,
  provider: "deepseek",
  baseUrl: "https://api.deepseek.com/v1",
  apiKey: "sk-test",
  model: "deepseek-chat",
  preference: "",
};

const messages: AiMessage[] = [
  { role: "system", content: "系统提示" },
  { role: "user", content: "改写这段" },
];

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function sseChunk(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n`;
}

function okResponse(chunks: string[]): Response {
  return { ok: true, status: 200, body: streamOf(chunks) } as Response;
}

function errorResponse(status: number, body: string): Response {
  return {
    ok: false,
    status,
    text: async () => body,
  } as Response;
}

describe("流式解析", () => {
  it("拼装分片并按增量回调", async () => {
    const onDelta = vi.fn();
    const fetchImpl = vi.fn(async () =>
      okResponse([sseChunk("公众号"), sseChunk("排版"), "data: [DONE]\n"]),
    );

    const result = await streamChatCompletion({
      config,
      messages,
      onDelta,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toBe("公众号排版");
    expect(onDelta.mock.calls.map((c) => c[0])).toEqual(["公众号", "排版"]);
  });

  it("单个 SSE 行被切分到两个分片时仍能还原", async () => {
    const full = sseChunk("完整句子");
    const cut = Math.floor(full.length / 2);
    const fetchImpl = vi.fn(async () =>
      okResponse([full.slice(0, cut), full.slice(cut)]),
    );

    const result = await streamChatCompletion({
      config,
      messages,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toBe("完整句子");
  });

  it("[DONE] 之后的内容不再计入", async () => {
    const fetchImpl = vi.fn(async () =>
      okResponse([sseChunk("保留"), "data: [DONE]\n"]),
    );

    const result = await streamChatCompletion({
      config,
      messages,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toBe("保留");
  });

  it("跳过心跳与无法解析的行，不中断整体流", async () => {
    const fetchImpl = vi.fn(async () =>
      okResponse([
        ": keep-alive\n",
        "\n",
        "data: {坏掉的 json\n",
        sseChunk("正文"),
      ]),
    );

    const result = await streamChatCompletion({
      config,
      messages,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toBe("正文");
  });

  it("末尾没有换行的最后一行也会被解析", async () => {
    const fetchImpl = vi.fn(async () =>
      okResponse([sseChunk("前半"), sseChunk("末行").trimEnd()]),
    );

    const result = await streamChatCompletion({
      config,
      messages,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toBe("前半末行");
  });
});

describe("请求构造", () => {
  it("拼出 chat/completions 端点并带上鉴权与流式标记", async () => {
    const fetchImpl = vi.fn(async () => okResponse([sseChunk("x")]));

    await streamChatCompletion({
      config,
      messages,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.deepseek.com/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer sk-test",
    );

    const payload = JSON.parse(init.body as string);
    expect(payload.model).toBe("deepseek-chat");
    expect(payload.stream).toBe(true);
    expect(payload.temperature).toBe(0.3);
    expect(payload.messages).toEqual(messages);
    expect(payload.thinking).toEqual({ type: "disabled" });
  });
});

describe("失败分类", () => {
  async function expectKind(
    response: Response | (() => never),
    kind: string,
  ): Promise<AiRequestError> {
    const fetchImpl = vi.fn(async () => {
      if (typeof response === "function") response();
      return response as Response;
    });

    try {
      await streamChatCompletion({
        config,
        messages,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(AiRequestError);
      expect((error as AiRequestError).kind).toBe(kind);
      return error as AiRequestError;
    }
    throw new Error(`预期抛出 ${kind}，但请求成功了`);
  }

  it("401 归类为鉴权失败并指向设置", async () => {
    const error = await expectKind(
      errorResponse(401, JSON.stringify({ error: { message: "bad key" } })),
      "auth",
    );
    expect(error.status).toBe(401);
    expect(error.message).toContain("AI 优化");
    expect(error.message).toContain("bad key");
  });

  it("429 归类为限流并提示余额", async () => {
    const error = await expectKind(errorResponse(429, ""), "rate_limit");
    expect(error.message).toContain("余额");
  });

  it("5xx 归类为服务端故障", async () => {
    const error = await expectKind(errorResponse(503, ""), "server");
    expect(error.message).toContain("503");
  });

  it("400 归类为请求错误并指向模型名", async () => {
    const error = await expectKind(errorResponse(400, ""), "bad_request");
    expect(error.message).toContain("模型名称");
  });

  it("fetch 抛 TypeError 时提示 CORS 与 Base URL，而不是笼统失败", async () => {
    const error = await expectKind(() => {
      throw new TypeError("Failed to fetch");
    }, "network");
    expect(error.message).toContain("CORS");
    expect(error.message).toContain("Base URL");
  });

  it("离线时给出网络提示而非 CORS 提示", async () => {
    const spy = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);

    const error = await expectKind(() => {
      throw new TypeError("Failed to fetch");
    }, "offline");
    expect(error.message).toContain("网络");
    expect(error.message).not.toContain("CORS");

    spy.mockRestore();
  });

  it("响应没有 body 时归类为格式异常", async () => {
    await expectKind(
      { ok: true, status: 200, body: null } as Response,
      "malformed",
    );
  });

  it("流结束但没有正文时归类为格式异常", async () => {
    await expectKind(okResponse(["data: [DONE]\n"]), "malformed");
  });
});

describe("思考内容", () => {
  it("reasoning_content 只报告进度，不计入结果", async () => {
    const onReasoning = vi.fn();
    const thinking = `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "先想一下" } }] })}\n`;
    const fetchImpl = vi.fn(async () =>
      okResponse([thinking, sseChunk("正文"), "data: [DONE]\n"]),
    );

    const result = await streamChatCompletion({
      config,
      messages,
      onReasoning,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(onReasoning).toHaveBeenCalledWith("先想一下");
    expect(result).toBe("正文");
  });

  it("OpenRouter 的 reasoning_details 同样识别为思考", async () => {
    const onReasoning = vi.fn();
    const thinking = `data: ${JSON.stringify({
      choices: [
        { delta: { reasoning_details: [{ text: "分" }, { text: "析" }] } },
      ],
    })}\n`;
    const fetchImpl = vi.fn(async () =>
      okResponse([thinking, sseChunk("正文"), "data: [DONE]\n"]),
    );

    const result = await streamChatCompletion({
      config,
      messages,
      onReasoning,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(onReasoning).toHaveBeenCalledWith("分析");
    expect(result).toBe("正文");
  });
});

describe("连通性探针", () => {
  it("走真实流式路径并返回首字耗时", async () => {
    const fetchImpl = vi.fn(async () =>
      okResponse([sseChunk("好"), "data: [DONE]\n"]),
    );

    const probe = await testConnection({
      config,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const payload = JSON.parse(
      (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1]
        .body as string,
    );
    expect(payload.stream).toBe(true);
    expect(probe.firstTokenMs).toBeGreaterThanOrEqual(0);
  });

  it("鉴权失败照常抛出，沿用同一套分类", async () => {
    const fetchImpl = vi.fn(async () => errorResponse(401, ""));
    await expect(
      testConnection({
        config,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ kind: "auth" });
  });
});

describe("模型筛选", () => {
  it("按声明筛选：输出恰好只有 text 才算对话模型", () => {
    expect(
      isChatModel({ id: "a", architecture: { output_modalities: ["text"] } }),
    ).toBe(true);
    expect(
      isChatModel({
        id: "google/gemini-3-pro-image",
        architecture: { output_modalities: ["image", "text"] },
      }),
    ).toBe(false);
    expect(
      isChatModel({
        id: "openai/gpt-audio",
        architecture: { output_modalities: ["text", "audio"] },
      }),
    ).toBe(false);
  });

  it("没有声明时按名字兜底，覆盖向量、重排、语音、图像、OCR", () => {
    for (const id of [
      "text-embedding-3-large",
      "BAAI/bge-m3",
      "BAAI/bge-reranker-v2-m3",
      "Pro/BAAI/bge-large-zh-v1.5",
      "whisper-1",
      "tts-1-hd",
      "FunAudioLLM/SenseVoiceSmall",
      "FunAudioLLM/CosyVoice2-0.5B",
      "dall-e-3",
      "Kwai-Kolors/Kolors",
      "stable-diffusion-xl",
      "deepseek-ai/DeepSeek-OCR",
      "stepfun-ai/GOT-OCR2_0",
      "omni-moderation-latest",
    ]) {
      expect(isChatModel({ id }), id).toBe(false);
    }
  });

  it("正常对话模型不被误杀", () => {
    for (const id of [
      "deepseek-v4-flash",
      "deepseek-v4-pro",
      "deepseek-ai/DeepSeek-V3.1-Terminus",
      "deepseek-ai/DeepSeek-V4-Flash",
      "glm-4-flash",
      "moonshot-v1-8k",
      "qwen-plus",
      "gpt-4o-mini",
      "Qwen/Qwen2.5-7B-Instruct",
      "Qwen/QwQ-32B",
      "THUDM/glm-4-9b-chat",
    ]) {
      expect(isChatModel({ id }), id).toBe(true);
    }
  });
});

describe("停滞检测", () => {
  it("久无分片时归类为 timeout 并提示换模型，而不是无限转", async () => {
    vi.useFakeTimers();
    const body = new ReadableStream<Uint8Array>({
      start() {},
      cancel() {},
    });
    const fetchImpl = vi.fn(
      async () => ({ ok: true, status: 200, body }) as Response,
    );

    const promise = streamChatCompletion({
      config,
      messages,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const assertion = expect(promise).rejects.toMatchObject({
      kind: "timeout",
    });

    await vi.advanceTimersByTimeAsync(46000);
    await assertion;
    vi.useRealTimers();
  });
});

describe("取消", () => {
  it("请求阶段被取消时抛出 aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const fetchImpl = vi.fn(async () => {
      throw new DOMException("Aborted", "AbortError");
    });

    await expect(
      streamChatCompletion({
        config,
        messages,
        signal: controller.signal,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ kind: "aborted" });
  });

  it("读流过程中被取消时抛出 aborted，而不是网络错误", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sseChunk("片段")));
      },
      pull() {
        throw new DOMException("Aborted", "AbortError");
      },
    });

    const fetchImpl = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          body,
        }) as Response,
    );

    await expect(
      streamChatCompletion({
        config,
        messages,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ kind: "aborted" });
  });
});
