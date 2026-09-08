/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import {
  isSupportedImageHostType,
  type ImageHostConfig,
} from "../../services/image/ImageUploader";
import {
  HostTabs,
  OfficialHostPanel,
  QiniuPanel,
  S3Panel,
  TencentPanel,
  type HostTestResult,
} from "./ImageHostSettingsPanels";
import "./ImageHostSettings.css";

interface AllConfigs {
  currentType: ImageHostConfig["type"] | null;
  configs: {
    official?: any;
    qiniu?: any;
    tencent?: any;
    s3?: any;
  };
}

export function ImageHostSettings() {
  const [allConfigs, setAllConfigs] = useState<AllConfigs>(() => {
    const saved = localStorage.getItem("imageHostConfigs");
    try {
      if (!saved) {
        const legacy = localStorage.getItem("imageHostConfig");
        if (!legacy) return { currentType: "official", configs: {} };
        const parsed = JSON.parse(legacy);
        if (!isSupportedImageHostType(parsed?.type))
          return { currentType: null, configs: {} };
        return {
          currentType: parsed.type,
          configs: { [parsed.type]: parsed.config },
        };
      }
      const parsed = JSON.parse(saved);
      return {
        currentType: isSupportedImageHostType(parsed?.currentType)
          ? parsed.currentType
          : null,
        // Unknown legacy entries remain opaque: never index them or activate a fallback.
        configs:
          parsed?.configs && typeof parsed.configs === "object"
            ? parsed.configs
            : {},
      };
    } catch {
      return { currentType: null, configs: {} };
    }
  });
  const [viewingType, setViewingType] = useState<ImageHostConfig["type"]>(
    allConfigs.currentType ?? "official",
  );
  const [testResult, setTestResult] = useState<HostTestResult | null>(null);

  const activeType = allConfigs.currentType;
  const viewingConfig: ImageHostConfig = {
    type: viewingType,
    config: allConfigs.configs[viewingType],
  };

  useEffect(() => {
    // Keep existing storage untouched until the user explicitly activates a supported host.
    if (!allConfigs.currentType) return;
    localStorage.setItem("imageHostConfigs", JSON.stringify(allConfigs));
    const currentConfig = {
      type: allConfigs.currentType,
      config: allConfigs.configs[allConfigs.currentType],
    };
    localStorage.setItem("imageHostConfig", JSON.stringify(currentConfig));
  }, [allConfigs]);

  const handleTabChange = (type: ImageHostConfig["type"]) => {
    setViewingType(type);
    setTestResult(null);
  };

  const handleConfigChange = (key: string, value: string) => {
    setAllConfigs((prev) => ({
      ...prev,
      configs: {
        ...prev.configs,
        [viewingType]: {
          ...prev.configs[viewingType],
          [key]: value,
        },
      },
    }));
  };

  const testConnection = async () => {
    setTestResult({ status: "loading", message: "正在测试连接" });
    try {
      const { ImageHostManager } = await import(
        "../../services/image/ImageUploader"
      );
      const manager = new ImageHostManager(viewingConfig);
      const valid = await manager.validate();
      setTestResult(
        valid
          ? { status: "success", message: "配置有效" }
          : { status: "error", message: "配置无效" },
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setTestResult({ status: "error", message });
    }
  };

  const handleActivate = async (type: ImageHostConfig["type"]) => {
    const originalText = document.activeElement?.textContent;
    const btn = document.activeElement as HTMLButtonElement;
    if (btn) {
      btn.disabled = true;
      btn.textContent = "验证中...";
    }

    try {
      const { ImageHostManager } = await import(
        "../../services/image/ImageUploader"
      );
      const configToTest: ImageHostConfig = {
        type,
        config: allConfigs.configs[type],
      };
      const manager = new ImageHostManager(configToTest);
      const valid = await manager.validate();
      if (valid) {
        setAllConfigs((prev) => ({ ...prev, currentType: type }));
        setTestResult(null);
      } else {
        setTestResult({
          status: "error",
          message: "无法启用：图床连接测试失败，请检查配置",
        });
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setTestResult({
        status: "error",
        message: `无法启用：验证过程出错（${message}）`,
      });
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent =
          originalText ||
          `启用${
            type === "tencent"
              ? "腾讯云 COS"
              : type === "s3"
                ? "S3 图床"
                : "七牛云图床"
          }`;
      }
    }
  };

  return (
    <div className="image-host-settings">
      {!activeType && (
        <p role="alert">
          此前选择的图床已停用或不受支持。上传保持关闭，请明确选择并启用其他服务；旧图床凭据不会用于上传。
        </p>
      )}
      <HostTabs
        activeType={activeType}
        viewingType={viewingType}
        onTabChange={handleTabChange}
      />

      <div className="host-config-panel">
        {viewingConfig.type === "official" && (
          <OfficialHostPanel
            activeType={activeType}
            viewingConfig={viewingConfig}
            testResult={testResult}
            onConfigChange={handleConfigChange}
            onTestConnection={testConnection}
            onActivate={() => handleActivate("official")}
          />
        )}

        {viewingConfig.type === "qiniu" && (
          <QiniuPanel
            activeType={activeType}
            viewingConfig={viewingConfig}
            testResult={testResult}
            onConfigChange={handleConfigChange}
            onTestConnection={testConnection}
            onActivate={handleActivate}
          />
        )}

        {viewingConfig.type === "tencent" && (
          <TencentPanel
            activeType={activeType}
            viewingConfig={viewingConfig}
            testResult={testResult}
            onConfigChange={handleConfigChange}
            onTestConnection={testConnection}
            onActivate={handleActivate}
          />
        )}

        {viewingConfig.type === "s3" && (
          <S3Panel
            activeType={activeType}
            viewingConfig={viewingConfig}
            testResult={testResult}
            onConfigChange={handleConfigChange}
            onTestConnection={testConnection}
            onActivate={handleActivate}
          />
        )}
      </div>
    </div>
  );
}
