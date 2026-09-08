import { describe, expect, it } from "vitest";

import {
  beginAiRequest,
  cancelActiveAiRequest,
} from "../../services/ai/aiRequestCoordinator";

describe("AI 请求协调器", () => {
  it("新请求会取消旧请求，旧租约不能再写回状态", () => {
    const first = beginAiRequest();
    const second = beginAiRequest();

    expect(first.controller.signal.aborted).toBe(true);
    expect(first.isCurrent()).toBe(false);
    expect(second.isCurrent()).toBe(true);

    cancelActiveAiRequest();
    expect(second.controller.signal.aborted).toBe(true);
    expect(second.isCurrent()).toBe(false);
  });
});
