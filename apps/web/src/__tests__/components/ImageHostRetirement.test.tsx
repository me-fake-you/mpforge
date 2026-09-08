import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ImageHostSettings } from "../../components/Settings/ImageHostSettings";
import {
  ImageHostManager,
  type ImageHostConfig,
} from "../../services/image/ImageUploader";
import {
  getStoredImageHostConfig,
  uploadEditorImage,
} from "../../services/image/imageUploadFlow";

let saved: Map<string, string>;
beforeEach(() => {
  saved = new Map();
  vi.stubGlobal("localStorage", {
    getItem: vi.fn((key: string) => saved.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      saved.set(key, value);
    }),
  });
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("retired image host compatibility", () => {
  it("rejects the retired discriminator before accessing its credentials or loading a fallback", () => {
    const readCredentials = vi.fn(() => {
      throw new Error("credentials were accessed");
    });
    const legacy = Object.defineProperty({ type: "aliyun" }, "config", {
      get: readCredentials,
    });
    expect(() => new ImageHostManager(legacy as ImageHostConfig)).toThrow(
      /已停用或不受支持/,
    );
    expect(readCredentials).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects persisted retired uploads and never forwards them to another service", async () => {
    saved.set(
      "imageHostConfig",
      JSON.stringify({
        type: "aliyun",
        config: { accessKeySecret: "retired-test-value" },
      }),
    );
    expect(() => getStoredImageHostConfig()).toThrow(/旧配置不会用于上传/);
    await expect(
      uploadEditorImage(
        new File(["small"], "image.png", { type: "image/png" }),
      ),
    ).rejects.toThrow(/旧配置不会用于上传/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["multi", "single"])(
    "opens %s legacy settings without exposing credentials, enabling a fallback, or changing stored data",
    (format) => {
      const key = format === "multi" ? "imageHostConfigs" : "imageHostConfig";
      const raw = JSON.stringify(
        format === "multi"
          ? {
              currentType: "aliyun",
              configs: { aliyun: { accessKeySecret: "retired-test-value" } },
            }
          : {
              type: "aliyun",
              config: { accessKeySecret: "retired-test-value" },
            },
      );
      saved.set(key, raw);
      render(<ImageHostSettings />);
      expect(screen.getByRole("alert")).toHaveTextContent("上传保持关闭");
      expect(
        screen.queryByRole("button", { name: /阿里云 OSS/ }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByDisplayValue("retired-test-value"),
      ).not.toBeInTheDocument();
      expect(localStorage.setItem).not.toHaveBeenCalled();
      for (const name of [
        "七牛云",
        "腾讯云 COS",
        "S3 兼容",
        "外部自托管端点",
      ]) {
        fireEvent.click(screen.getByRole("button", { name }));
      }
      expect(saved.get(key)).toBe(raw);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("retains explicitly configured supported uploads", async () => {
    saved.set(
      "imageHostConfig",
      JSON.stringify({
        type: "official",
        config: { serverUrl: "https://upload.example.test" },
      }),
    );
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ url: "https://cdn.example.test/image.png" }),
        { status: 200 },
      ),
    );
    const result = await uploadEditorImage(
      new File(["small"], "image.png", { type: "image/png" }),
    );
    expect(result.url).toBe("https://cdn.example.test/image.png");
    expect(fetch).toHaveBeenCalledWith(
      "https://upload.example.test/upload",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
