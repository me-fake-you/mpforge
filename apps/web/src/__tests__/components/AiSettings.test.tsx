import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const mocked = vi.hoisted(() => ({ testConnection: vi.fn() }));

vi.mock("react-hot-toast", () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("../../services/ai/aiClient", async () => {
  const actual = await vi.importActual<
    typeof import("../../services/ai/aiClient")
  >("../../services/ai/aiClient");
  return { ...actual, testConnection: mocked.testConnection };
});

import { AiSettings } from "../../components/Settings/AiSettings";
import {
  AI_CONFIG_STORAGE_KEY,
  getAiConfig,
  getProviderPreset,
} from "../../services/ai/aiConfig";

const typeInto = (label: string, value: string) => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
};

const pickProvider = (label: string) => {
  fireEvent.click(screen.getByRole("button", { name: /服务商/ }));
  fireEvent.click(screen.getByRole("option", { name: new RegExp(label) }));
};

describe("AI 改写设置", () => {
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

  it("未保存前开关不可用", () => {
    render(<AiSettings />);
    const toggle = screen.getByRole("switch", { name: "启用 AI 优化" });
    expect(toggle).toBeDisabled();
    expect(screen.getByText("填写 API Key 并保存后可启用")).toBeInTheDocument();
  });

  it("填 Key 但未保存时开关仍不可用", () => {
    render(<AiSettings />);
    typeInto("API Key", "sk-test");
    expect(screen.getByRole("switch", { name: "启用 AI 优化" })).toBeDisabled();
  });

  it("保存后自动开启，避免填了却没反应", () => {
    render(<AiSettings />);
    typeInto("API Key", "sk-test");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    const toggle = screen.getByRole("switch", { name: "启用 AI 优化" });
    expect(toggle).toBeEnabled();
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(getAiConfig().enabled).toBe(true);
  });

  it("开关即时生效，不需要再按保存", () => {
    render(<AiSettings />);
    typeInto("API Key", "sk-test");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    fireEvent.click(screen.getByRole("switch", { name: "启用 AI 优化" }));
    expect(getAiConfig().enabled).toBe(false);
    expect(getAiConfig().apiKey).toBe("sk-test");
  });

  it("默认服务商不展示 Base URL，选自定义后才展开", () => {
    render(<AiSettings />);

    expect(screen.queryByLabelText("Base URL")).not.toBeInTheDocument();
    pickProvider("自定义");
    expect(screen.getByLabelText("Base URL")).toBeInTheDocument();
  });

  it("模型字段始终可编辑，切换服务商时回填预设", () => {
    render(<AiSettings />);
    expect(screen.getByLabelText("模型")).toHaveValue(
      getProviderPreset("deepseek").defaultModel,
    );

    pickProvider("Kimi");
    expect(screen.getByLabelText("模型")).toHaveValue(
      getProviderPreset("moonshot").defaultModel,
    );

    typeInto("模型", "kimi-latest");
    expect(screen.getByLabelText("模型")).toHaveValue("kimi-latest");
  });

  it("保存后写入本机配置", () => {
    render(<AiSettings />);
    typeInto("API Key", "sk-saved");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(localStorage.setItem).toHaveBeenCalledWith(
      AI_CONFIG_STORAGE_KEY,
      expect.stringContaining("sk-saved"),
    );
    const saved = getAiConfig();
    expect(saved.apiKey).toBe("sk-saved");
    expect(saved.enabled).toBe(true);
  });

  it("关闭后再改字段并保存，不会被重新打开", async () => {
    render(<AiSettings />);
    typeInto("API Key", "sk-keep");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "保存" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("switch", { name: "启用 AI 优化" }));

    typeInto("模型", "deepseek-reasoner");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    const saved = getAiConfig();
    expect(saved.enabled).toBe(false);
    expect(saved.model).toBe("deepseek-reasoner");
    expect(saved.apiKey).toBe("sk-keep");
  });

  it("保存后先给出反馈再关闭弹窗", async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<AiSettings onClose={onClose} />);

    typeInto("API Key", "sk-save");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(screen.getByRole("button", { name: /已保存/ })).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(onClose).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("测试连接成功不关窗，便于继续调整", async () => {
    mocked.testConnection.mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<AiSettings onClose={onClose} />);

    typeInto("API Key", "sk-verified");
    fireEvent.click(screen.getByRole("button", { name: "测试连接" }));

    await waitFor(() => expect(getAiConfig().apiKey).toBe("sk-verified"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("测试连接成功即落盘，切走再切回不丢 Key", async () => {
    mocked.testConnection.mockResolvedValue(undefined);
    render(<AiSettings />);

    typeInto("API Key", "sk-verified");
    fireEvent.click(screen.getByRole("button", { name: "测试连接" }));

    await waitFor(() => expect(getAiConfig().apiKey).toBe("sk-verified"));
    expect(getAiConfig().enabled).toBe(true);
  });

  it("测试失败时不写入配置", async () => {
    const { AiRequestError } = await import("../../services/ai/aiClient");
    mocked.testConnection.mockRejectedValue(
      new AiRequestError("auth", "API Key 无效", 401),
    );
    render(<AiSettings />);

    typeInto("API Key", "sk-bad");
    fireEvent.click(screen.getByRole("button", { name: "测试连接" }));

    await waitFor(() =>
      expect(screen.getByText("API Key 无效")).toBeInTheDocument(),
    );
    expect(getAiConfig().apiKey).toBe("");
  });

  it("Key 默认遮蔽，可切换显示", () => {
    render(<AiSettings />);
    expect(screen.getByLabelText("API Key")).toHaveAttribute(
      "type",
      "password",
    );

    fireEvent.click(screen.getByLabelText("显示 API Key"));
    expect(screen.getByLabelText("API Key")).toHaveAttribute("type", "text");
  });

  it("展示隐私边界与触发方式", () => {
    render(<AiSettings />);
    expect(
      screen.getByText(/全文审阅与起标题最多发送正文前 12,000 字/),
    ).toBeInTheDocument();
    expect(
      screen.getByText("写作偏好会用于改写、全文审阅和起标题；留空则不发送。"),
    ).toBeInTheDocument();
    expect(screen.getByText(/选中文字，即可使用 AI 改写/)).toBeInTheDocument();
  });

  it("给出当前服务商的 Key 申领入口", () => {
    render(<AiSettings />);
    const link = screen.getByRole("link", { name: /获取 DeepSeek API Key/ });
    expect(link).toHaveAttribute(
      "href",
      "https://platform.deepseek.com/api_keys",
    );
  });
});
