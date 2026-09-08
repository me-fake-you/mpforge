import { act, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "../../components/ErrorBoundary/ErrorBoundary";

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "clipboard");
});

describe("ErrorBoundary", () => {
  it("剪贴板不可用时说明原因并给出手动复制路径", () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    const boundaryRef = createRef<ErrorBoundary>();

    render(
      <ErrorBoundary ref={boundaryRef}>
        <div>正常内容</div>
      </ErrorBoundary>,
    );
    act(() => {
      boundaryRef.current?.setState({
        hasError: true,
        error: new Error("测试错误"),
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "复制错误信息" }));

    expect(
      screen.getByRole("button", {
        name: "剪贴板不可用，请手动选中错误信息",
      }),
    ).toBeInTheDocument();
  });

  it("剪贴板写入失败时给出手动复制路径", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("权限被拒绝");
        },
      },
    });
    const boundaryRef = createRef<ErrorBoundary>();

    render(
      <ErrorBoundary ref={boundaryRef}>
        <div>正常内容</div>
      </ErrorBoundary>,
    );
    act(() => {
      boundaryRef.current?.setState({
        hasError: true,
        error: new Error("测试错误"),
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "复制错误信息" }));

    expect(
      await screen.findByRole("button", {
        name: "复制失败，请手动选中错误信息",
      }),
    ).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalledWith(
      "Failed to copy error:",
      expect.any(Error),
    );
  });
});
