import { beforeEach, describe, expect, it, vi } from "vitest";
import { StorageManager } from "../../storage/StorageManager";

const adapterControl = vi.hoisted(() => {
  let release: (() => void) | null = null;
  return {
    initCalls: 0,
    reset() {
      this.initCalls = 0;
      release = null;
    },
    waitForRelease() {
      this.initCalls += 1;
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    },
    release() {
      release?.();
    },
  };
});

vi.mock("../../storage/adapters/IndexedDBAdapter", () => ({
  IndexedDBAdapter: class {
    readonly type = "indexeddb" as const;
    readonly name = "Controlled IndexedDB";
    ready = false;

    async init() {
      await adapterControl.waitForRelease();
      this.ready = true;
      return { ready: true };
    }

    async teardown() {
      this.ready = false;
    }
  },
}));

describe("Round 1 browser storage restoration", () => {
  beforeEach(() => {
    adapterControl.reset();
    localStorage.clear();
  });

  it("shares one initialization promise across StrictMode-style concurrent restores", async () => {
    const manager = new StorageManager();
    const first = manager.restoreLastAdapter();

    await vi.waitFor(() => expect(adapterControl.initCalls).toBe(1));
    const second = manager.restoreLastAdapter();
    let secondSettled = false;
    void second.then(() => {
      secondSettled = true;
    });

    await Promise.resolve();
    expect(secondSettled).toBe(false);

    adapterControl.release();
    const [firstAdapter, secondAdapter] = await Promise.all([first, second]);
    expect(firstAdapter).toBe(secondAdapter);
    expect(firstAdapter?.ready).toBe(true);
    expect(adapterControl.initCalls).toBe(1);
  });
});
