import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocked = vi.hoisted(() => ({ fetchModels: vi.fn() }));

vi.mock("../../services/ai/aiClient", async () => {
  const actual = await vi.importActual<
    typeof import("../../services/ai/aiClient")
  >("../../services/ai/aiClient");
  return { ...actual, fetchModels: mocked.fetchModels };
});

import { AiRequestError } from "../../services/ai/aiClient";
import { AiModelField } from "../../components/Settings/AiModelField";
import type { AiConfig } from "../../services/ai/aiConfig";

const config: AiConfig = {
  enabled: true,
  provider: "deepseek",
  baseUrl: "https://api.deepseek.com/v1",
  apiKey: "sk-test",
  model: "",
  preference: "",
};

function renderField(overrides: Partial<AiConfig> = {}) {
  const onChange = vi.fn();
  render(
    <AiModelField
      config={{ ...config, ...overrides }}
      onChange={onChange}
      placeholder="模型名称"
    />,
  );
  return { onChange };
}

describe("模型选择", () => {
  beforeEach(() => vi.clearAllMocks());

  it("展开时才拉取列表，不在渲染时就发请求", () => {
    mocked.fetchModels.mockResolvedValue(["deepseek-v4-flash"]);
    renderField();
    expect(mocked.fetchModels).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("选择模型"));
    expect(mocked.fetchModels).toHaveBeenCalledTimes(1);
  });

  it("选中候选后回填模型名", async () => {
    mocked.fetchModels.mockResolvedValue([
      "deepseek-v4-flash",
      "deepseek-v4-pro",
    ]);
    const { onChange } = renderField();

    fireEvent.click(screen.getByLabelText("选择模型"));
    await waitFor(() =>
      expect(screen.getByText("deepseek-v4-pro")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByText("deepseek-v4-pro"));
    expect(onChange).toHaveBeenCalledWith("deepseek-v4-pro");
  });

  it("已选中某个模型时，同系列其他模型仍然可见", async () => {
    mocked.fetchModels.mockResolvedValue([
      "deepseek-v4-flash",
      "deepseek-v4-pro",
    ]);
    renderField({ model: "deepseek-v4-flash" });

    fireEvent.click(screen.getByLabelText("选择模型"));
    await waitFor(() =>
      expect(screen.getByText("deepseek-v4-pro")).toBeInTheDocument(),
    );
    expect(screen.getByText("deepseek-v4-flash")).toBeInTheDocument();
  });

  it("下拉内的搜索框才负责过滤", async () => {
    mocked.fetchModels.mockResolvedValue([
      "deepseek-v4-flash",
      "deepseek-v4-pro",
      "other-model",
    ]);
    renderField({ model: "deepseek-v4-flash" });

    fireEvent.click(screen.getByLabelText("选择模型"));
    await waitFor(() =>
      expect(screen.getByLabelText("搜索模型")).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByLabelText("搜索模型"), {
      target: { value: "pro" },
    });
    expect(screen.getByText("deepseek-v4-pro")).toBeInTheDocument();
    expect(screen.queryByText("other-model")).not.toBeInTheDocument();
  });

  it("端点不支持 /models 时不挡路，仍可手动填写", async () => {
    mocked.fetchModels.mockRejectedValue(
      new AiRequestError("bad_request", "请求被拒绝（HTTP 404）", 404),
    );
    renderField();

    fireEvent.click(screen.getByLabelText("选择模型"));
    await waitFor(() =>
      expect(screen.getByText(/请求被拒绝/)).toBeInTheDocument(),
    );
    expect(screen.getByPlaceholderText("模型名称")).toBeEnabled();
  });

  it("手动输入仍然生效", () => {
    const { onChange } = renderField();
    fireEvent.change(screen.getByPlaceholderText("模型名称"), {
      target: { value: "my-custom-model" },
    });
    expect(onChange).toHaveBeenCalledWith("my-custom-model");
  });
});
