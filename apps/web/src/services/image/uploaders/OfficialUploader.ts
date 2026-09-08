import type { ImageUploader } from "../ImageUploader";

interface OfficialConfig {
  serverUrl?: string;
}

/**
 * 可配置的托管图床。MPForge 不内置第三方上传端点。
 */
export class OfficialUploader implements ImageUploader {
  name = "外部自托管上传端点";
  private serverUrl: string;

  constructor(config?: OfficialConfig) {
    this.serverUrl = config?.serverUrl?.replace(/\/$/, "") || "";
  }

  configure(config: OfficialConfig) {
    if (config.serverUrl) {
      this.serverUrl = config.serverUrl;
    }
  }

  async validate(): Promise<boolean> {
    if (!this.serverUrl) return false;
    try {
      const url = new URL(this.serverUrl);
      return (
        url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "::1"].includes(url.hostname))
      );
    } catch {
      return false;
    }
  }

  async upload(file: File): Promise<string> {
    if (!this.serverUrl) {
      throw new Error("EXTERNAL_UPLOAD_ENDPOINT_NOT_CONFIGURED");
    }
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(`${this.serverUrl}/upload`, {
      method: "POST",
      body: formData,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || `上传失败: ${response.statusText}`);
    }

    if (!data.url) {
      throw new Error("服务器未返回图片地址");
    }

    return data.url;
  }
}
