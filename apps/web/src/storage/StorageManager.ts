import type { StorageAdapter } from "./StorageAdapter";
import type {
  StorageAdapterContext,
  StorageInitResult,
  StorageType,
} from "./types";

type AdapterFactory = () => Promise<StorageAdapter>;

const STORAGE_KEY = "wemd-storage-adapter";
const uniqueId = () => {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export class StorageManager {
  private adapter: StorageAdapter | null = null;
  private factories: Partial<Record<StorageType, AdapterFactory>> = {};
  private initialization: {
    type: StorageType;
    promise: Promise<StorageInitResult>;
  } | null = null;
  private restoration: Promise<StorageAdapter | null> | null = null;

  constructor() {
    this.factories.indexeddb = async () => {
      const module = await import("./adapters/IndexedDBAdapter");
      return new module.IndexedDBAdapter();
    };
    this.factories.filesystem = async () => {
      const module = await import("./adapters/FileSystemAdapter");
      return new module.FileSystemAdapter();
    };
  }

  static isFileSystemSupported(): boolean {
    return typeof window !== "undefined" && "showDirectoryPicker" in window;
  }

  get currentAdapter() {
    return this.adapter;
  }

  async setAdapter(
    type: StorageType,
    context?: StorageAdapterContext,
  ): Promise<StorageInitResult> {
    if (this.initialization) {
      if (this.initialization.type === type) return this.initialization.promise;
      await this.initialization.promise;
    }
    const factory = this.factories[type];
    if (!factory) throw new Error(`Adapter ${type} not registered`);
    const initialize = (async () => {
      if (this.adapter?.teardown) {
        await this.adapter.teardown();
      }
      const nextAdapter = await factory();
      let adapterContext = context;
      if (type === "filesystem") {
        const identifier = adapterContext?.identifier ?? uniqueId();
        adapterContext = { ...(adapterContext ?? {}), identifier };
      }
      const result = await nextAdapter.init(adapterContext);
      if (result.ready) {
        this.adapter = nextAdapter;
        try {
          localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
              type,
              identifier: adapterContext?.identifier,
              ts: Date.now(),
            }),
          );
        } catch {
          /* ignore */
        }
      }
      return result;
    })();
    this.initialization = { type, promise: initialize };
    try {
      return await initialize;
    } finally {
      if (this.initialization?.promise === initialize) {
        this.initialization = null;
      }
    }
  }

  async restoreLastAdapter(): Promise<StorageAdapter | null> {
    if (this.adapter?.ready) return this.adapter;
    if (this.restoration) return this.restoration;
    const restore = (async () => {
      let persisted: { type: StorageType; identifier?: string } | null = null;
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) persisted = JSON.parse(raw);
      } catch {
        persisted = null;
      }
      const type = persisted?.type ?? "indexeddb";
      const context: StorageAdapterContext | undefined =
        type === "filesystem"
          ? { identifier: persisted?.identifier ?? uniqueId() }
          : undefined;
      const result = await this.setAdapter(type, context);
      return result.ready && this.adapter?.ready ? this.adapter : null;
    })();
    this.restoration = restore;
    try {
      return await restore;
    } finally {
      if (this.restoration === restore) this.restoration = null;
    }
  }
}
