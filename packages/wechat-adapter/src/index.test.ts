import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  MockProvider,
  ProviderError,
  RealDraftProvider,
  type DraftArticleInput,
  type FetchLike,
  type WeChatDraftProvider,
} from "./index.js";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const cover = {
  relativePath: "assets/cover.jpg",
  contentHash: "cover-hash",
  mimeType: "image/jpeg",
  bytes: new Uint8Array([1, 2, 3]),
  materialType: "image" as const,
};

function article(
  overrides: Partial<DraftArticleInput> = {},
): DraftArticleInput {
  return {
    title: "Safe title",
    author: "Author",
    digest: "Digest",
    content: "<p>Body</p>",
    thumb_media_id: "cover-1",
    ...overrides,
  };
}

function mockFetch(): FetchLike {
  return vi.fn(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/v1/capabilities")) return json({ mock: true });
    if (url.endsWith("/v1/token"))
      return json({
        mock: true,
        access_token: "local-value",
        expires_in: 7200,
      });
    if (url.endsWith("/v1/body-images"))
      return json({
        mock: true,
        url: "http://127.0.0.1:8787/media/body-1",
        media_id: "body-1",
      });
    if (url.endsWith("/v1/cover-materials"))
      return json({
        mock: true,
        media_id: "cover-1",
        url: "http://127.0.0.1:8787/media/cover-1",
      });
    if (url.includes("/v1/drafts?") && init?.method === "GET")
      return json({
        mock: true,
        total_count: 1,
        item_count: 1,
        item: [
          {
            media_id: "draft-1",
            update_time: 100,
            content: { news_item: [article()] },
          },
        ],
      });
    if (url.endsWith("/v1/drafts/draft-1"))
      return json({ mock: true, media_id: "draft-1", news_item: [article()] });
    if (url.endsWith("/v1/drafts"))
      return json({ mock: true, media_id: "draft-1" });
    return json({ mock: true }, 404);
  });
}

function realFetch(): FetchLike {
  return vi.fn(async (input) => {
    const url = String(input);
    if (url.endsWith("/cgi-bin/stable_token"))
      return json({ access_token: "server-token", expires_in: 7200 });
    if (url.includes("/cgi-bin/media/uploadimg"))
      return json({
        errcode: 0,
        errmsg: "ok",
        url: "https://mmbiz.qpic.cn/body-1",
      });
    if (url.includes("/cgi-bin/material/add_material"))
      return json({
        media_id: "cover-1",
        url: "https://mmbiz.qpic.cn/cover-1",
      });
    if (url.includes("/cgi-bin/draft/add"))
      return json({ media_id: "draft-1" });
    if (url.includes("/cgi-bin/draft/get"))
      return json({ news_item: [article()] });
    if (url.includes("/cgi-bin/draft/batchget"))
      return json({
        total_count: 1,
        item_count: 1,
        item: [
          {
            media_id: "draft-1",
            update_time: 100,
            content: { news_item: [article()] },
          },
        ],
      });
    return json({}, 404);
  });
}

describe("provider surface", () => {
  it("exposes exactly the approved provider methods", () => {
    const provider = new MockProvider({
      baseUrl: "http://127.0.0.1:8787",
      fetch: mockFetch(),
    });
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(provider))
      .filter((key) => key !== "constructor")
      .sort();
    expect(methods).toEqual(
      [
        "createDraft",
        "findPossibleDraft",
        "getCapabilities",
        "getDraft",
        "listDrafts",
        "obtainAccessToken",
        "sanitizeRequest",
        "sanitizeResponse",
        "uploadBodyImage",
        "uploadCoverMaterial",
        "validateConfiguration",
      ].sort(),
    );
  });

  it("rejects a non-loopback mock server", () => {
    expect(
      () =>
        new MockProvider({
          baseUrl: "https://example.com",
          fetch: mockFetch(),
        }),
    ).toThrowError(ProviderError);
  });
});

describe("mock provider contract", () => {
  it("runs separate body image, cover, and draft contracts", async () => {
    const provider = new MockProvider({
      baseUrl: "http://127.0.0.1:8787",
      fetch: mockFetch(),
    });
    expect((await provider.getCapabilities()).providerMode).toBe("mock");
    expect((await provider.obtainAccessToken()).expiresInSeconds).toBe(7200);
    const body = await provider.uploadBodyImage({
      ...cover,
      mimeType: "image/png",
      relativePath: "assets/body.png",
    });
    expect(await provider.uploadCoverMaterial(cover)).toMatchObject({
      mediaId: "cover-1",
      materialType: "image",
    });
    const result = await provider.createDraft({
      articles: [article({ content: `<p>Body</p><img src="${body.url}">` })],
      idempotencyKey: "key-1",
    });
    expect(result.mediaId).toBe("draft-1");
    expect(
      (await provider.getDraft({ mediaId: result.mediaId })).newsItem,
    ).toHaveLength(1);
  });

  it("requires every response to carry the mock marker", async () => {
    const provider = new MockProvider({
      baseUrl: "http://localhost:8787",
      fetch: vi.fn(async () => json({})),
    });
    await expect(provider.getCapabilities()).rejects.toMatchObject({
      code: "MOCK_MARKER_REQUIRED",
    });
  });

  it("passes fault injection through a private transport header", async () => {
    const fetcher = mockFetch();
    const provider: WeChatDraftProvider = new MockProvider({
      baseUrl: "http://localhost:8787",
      fetch: fetcher,
      faultMode: () => "timeout_during_create",
    });
    await provider.obtainAccessToken();
    expect(fetcher).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-mpforge-fault": "timeout_during_create",
        }),
      }),
    );
  });
});

describe("real provider contract", () => {
  it("uses injected credentials and the stable token request", async () => {
    const fetcher = realFetch();
    const provider = new RealDraftProvider({
      credentialProvider: vi.fn(async () => ({
        appId: "wx_appid_123",
        appSecret: "sensitive-value",
      })),
      fetch: fetcher,
    });
    expect((await provider.obtainAccessToken()).accessToken).toBe(
      "server-token",
    );
    const [url, init] = vi.mocked(fetcher).mock.calls[0];
    expect(String(url).endsWith("/cgi-bin/stable_token")).toBe(true);
    expect(JSON.parse(String(init?.body))).toMatchObject({
      force_refresh: false,
      grant_type: "client_credential",
    });
  });

  it("builds distinct official media and draft requests", async () => {
    const fetcher = realFetch();
    const provider = new RealDraftProvider({
      credentialProvider: vi.fn(async () => ({
        appId: "wx_appid_123",
        appSecret: "s",
      })),
      fetch: fetcher,
    });
    const body = await provider.uploadBodyImage({
      ...cover,
      mimeType: "image/png",
      relativePath: "assets/body.png",
      accessToken: "token-value",
    });
    const coverResult = await provider.uploadCoverMaterial({
      ...cover,
      accessToken: "token-value",
    });
    const created = await provider.createDraft({
      accessToken: "token-value",
      articles: [
        article({
          content: `<img src="${body.url}">`,
          thumb_media_id: coverResult.mediaId,
        }),
      ],
    });
    expect(created.mediaId).toBe("draft-1");
    const urls = vi.mocked(fetcher).mock.calls.map(([value]) => String(value));
    expect(
      urls.some((value) => value.includes("/cgi-bin/media/uploadimg")),
    ).toBe(true);
    expect(
      urls.some((value) => value.includes("/cgi-bin/material/add_material")),
    ).toBe(true);
    expect(urls.some((value) => value.includes("/cgi-bin/draft/add"))).toBe(
      true,
    );
  });

  it("never calls the network when credentials are absent", async () => {
    const fetcher = realFetch();
    const provider = new RealDraftProvider({
      credentialProvider: vi.fn(async () => undefined),
      fetch: fetcher,
    });
    await expect(provider.obtainAccessToken()).rejects.toMatchObject({
      code: "CREDENTIALS_MISSING",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("marks a lost create response uncertain and non-retryable", async () => {
    const provider = new RealDraftProvider({
      credentialProvider: vi.fn(async () => ({
        appId: "wx_appid_123",
        appSecret: "s",
      })),
      fetch: vi.fn(async () => {
        throw new Error("connection reset access_token=do-not-copy");
      }),
    });
    await expect(
      provider.createDraft({
        accessToken: "token-value",
        articles: [article()],
      }),
    ).rejects.toMatchObject({
      code: "UNKNOWN_REMOTE_RESPONSE",
      uncertainSideEffect: true,
      retryable: false,
    });
  });

  it("classifies errors without returning credential material", async () => {
    const provider = new RealDraftProvider({
      credentialProvider: vi.fn(async () => ({
        appId: "wx_appid_123",
        appSecret: "sensitive-value",
      })),
      fetch: vi.fn(async () =>
        json({ errcode: 40125, errmsg: "invalid secret=sensitive-value" }),
      ),
    });
    let error: ProviderError;
    try {
      await provider.obtainAccessToken();
      throw new Error("Expected provider failure");
    } catch (reason) {
      error = reason as ProviderError;
    }
    expect(error).toMatchObject({
      code: 40125,
      category: "CONFIGURATION",
      retryable: false,
    });
    expect(error.message).not.toContain("sensitive-value");
  });

  it.each([
    [40005, "INPUT", false],
    [40007, "IDENTIFIER", false],
    [45011, "RATE_LIMIT", true],
    [48001, "PERMISSION", false],
    [50002, "ACCOUNT_RESTRICTION", false],
    [-1, "REMOTE_BUSY", true],
  ] as const)(
    "classifies official code %s as %s",
    async (code, category, retryable) => {
      const provider = new RealDraftProvider({
        credentialProvider: vi.fn(async () => ({
          appId: "wx_appid_123",
          appSecret: "server-value",
        })),
        fetch: vi.fn(async () =>
          json({ errcode: code, errmsg: "official error" }),
        ),
      });
      let error: ProviderError;
      try {
        await provider.obtainAccessToken();
        throw new Error("Expected provider failure");
      } catch (reason) {
        error = reason as ProviderError;
      }
      expect(error).toMatchObject({ code, category, retryable });
    },
  );

  it("does not mark an uncertain side-effect response as directly retryable", async () => {
    const provider = new RealDraftProvider({
      credentialProvider: vi.fn(async () => ({
        appId: "wx_appid_123",
        appSecret: "server-value",
      })),
      fetch: vi.fn(async () => json({ errcode: -1, errmsg: "system busy" })),
    });
    await expect(
      provider.createDraft({
        accessToken: "token-value",
        articles: [article()],
      }),
    ).rejects.toMatchObject({
      code: -1,
      category: "REMOTE_BUSY",
      retryable: false,
      uncertainSideEffect: true,
    });
  });
});

describe("validation and candidate search", () => {
  it("rejects invalid media before fetch", async () => {
    const fetcher = mockFetch();
    const provider = new MockProvider({
      baseUrl: "http://localhost:8787",
      fetch: fetcher,
    });
    await expect(
      provider.uploadBodyImage({ ...cover, mimeType: "image/gif" }),
    ).rejects.toMatchObject({ code: 40005 });
    await expect(
      provider.uploadBodyImage({
        ...cover,
        mimeType: "image/png",
        bytes: new Uint8Array(1_000_000),
      }),
    ).rejects.toMatchObject({ code: 40009 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects executable HTML and untrusted body images", async () => {
    const provider = new MockProvider({
      baseUrl: "http://localhost:8787",
      fetch: mockFetch(),
    });
    await expect(
      provider.createDraft({
        articles: [article({ content: "<script>alert(1)</script>" })],
      }),
    ).rejects.toMatchObject({ code: "UNSAFE_HTML" });
    await expect(
      provider.createDraft({
        articles: [
          article({ content: '<img src="https://example.com/x.png">' }),
        ],
      }),
    ).rejects.toMatchObject({ code: "UNTRUSTED_BODY_IMAGE_URL" });
  });

  it("paginates candidates without assuming list order", async () => {
    const fetcher: FetchLike = vi.fn(async (input) => {
      const offset = Number(new URL(String(input)).searchParams.get("offset"));
      return json({
        mock: true,
        total_count: 21,
        item_count: offset === 0 ? 20 : 1,
        item:
          offset === 0
            ? Array.from({ length: 20 }, (_, index) => ({
                media_id: `other-${index}`,
                content: { news_item: [article({ title: `Other ${index}` })] },
              }))
            : [
                {
                  media_id: "candidate",
                  update_time: 100,
                  content: {
                    news_item: [article({ content: "exact-content" })],
                  },
                },
              ],
      });
    });
    const provider = new MockProvider({
      baseUrl: "http://localhost:8787",
      fetch: fetcher,
    });
    const result = await provider.findPossibleDraft({
      title: "Safe title",
      contentHash: createHash("sha256").update("exact-content").digest("hex"),
    });
    expect(result).toMatchObject({
      disposition: "ONE_CANDIDATE",
      pagesExamined: 2,
      orderingAssumed: false,
    });
  });

  it("returns ambiguity for multiple candidates", async () => {
    const fetcher: FetchLike = vi.fn(async () =>
      json({
        mock: true,
        total_count: 2,
        item_count: 2,
        item: ["a", "b"].map((media_id) => ({
          media_id,
          content: { news_item: [article()] },
        })),
      }),
    );
    const provider = new MockProvider({
      baseUrl: "http://localhost:8787",
      fetch: fetcher,
    });
    expect(
      (await provider.findPossibleDraft({ title: "Safe title" })).disposition,
    ).toBe("AMBIGUOUS");
  });
});

describe("recursive sanitization", () => {
  it("redacts sensitive keys and URL query values without mutation", () => {
    const provider = new MockProvider({
      baseUrl: "http://localhost:8787",
      fetch: mockFetch(),
    });
    const input = {
      appSecret: "one",
      nested: [
        {
          access_token: "two",
          url: "https://api.example.test/path?access_token=three&offset=0",
        },
      ],
      title: "kept",
    };
    expect(provider.sanitizeRequest(input)).toEqual({
      appSecret: "[REDACTED]",
      nested: [
        {
          access_token: "[REDACTED]",
          url: "https://api.example.test/path?access_token=%5BREDACTED%5D&offset=0",
        },
      ],
      title: "kept",
    });
    expect(input.appSecret).toBe("one");
  });

  it("does not echo sensitive remote error text", async () => {
    const provider = new MockProvider({
      baseUrl: "http://localhost:8787",
      fetch: vi.fn(async () =>
        json({
          mock: true,
          errcode: 40001,
          errmsg: "access_token=super-sensitive",
        }),
      ),
    });
    let error: ProviderError;
    try {
      await provider.obtainAccessToken();
      throw new Error("Expected provider failure");
    } catch (reason) {
      error = reason as ProviderError;
    }
    expect(error.message).not.toContain("super-sensitive");
  });
});
