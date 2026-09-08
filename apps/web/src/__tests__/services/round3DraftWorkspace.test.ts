import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  round3DraftClient,
  visibleCredentialStatus,
} from "../../services/round3DraftWorkspace";

describe("Round 3 desktop client", () => {
  beforeEach(() => {
    Object.defineProperty(window, "electron", {
      configurable: true,
      value: undefined,
    });
  });

  it.each(["configured", "missing", "invalid", "unverified"] as const)(
    "shows only the safe credential state %s",
    (status) => {
      expect(visibleCredentialStatus(status)).toBe(status);
    },
  );

  it("maps unknown credential labels to invalid", () => {
    expect(visibleCredentialStatus("secret-present")).toBe("invalid");
  });

  it("fails closed when the controlled desktop backend is absent", async () => {
    expect(round3DraftClient.available()).toBe(false);
    await expect(round3DraftClient.listAccounts()).rejects.toThrow(
      /controlled desktop backend/,
    );
  });

  it("sends only a human request for real plans", async () => {
    const requestReal = vi.fn().mockResolvedValue({
      success: true,
      request: {
        request_id: "human-request-1",
        status: "AWAITING_INTERACTIVE_HUMAN_TERMINAL",
      },
    });
    Object.defineProperty(window, "electron", {
      configurable: true,
      value: {
        round3: {
          requestReal,
        },
      },
    });

    await expect(
      round3DraftClient.requestReal("draft-real-1", "human-reviewer"),
    ).resolves.toMatchObject({ request_id: "human-request-1" });
    expect(requestReal).toHaveBeenCalledWith({
      operationId: "draft-real-1",
      requestedBy: "human-reviewer",
    });
  });
});
