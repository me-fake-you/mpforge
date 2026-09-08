import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface BrowserPageLike {
  on(
    event: "console",
    listener: (message: { type(): string; text(): string }) => void,
  ): void;
  on(event: "pageerror", listener: (error: Error) => void): void;
  route(
    url: string | RegExp,
    handler: (route: {
      request(): { url(): string };
      abort(code?: string): Promise<void>;
      continue(): Promise<void>;
    }) => Promise<void>,
  ): Promise<void>;
  setContent(
    html: string,
    options?: { waitUntil?: "load" | "domcontentloaded" },
  ): Promise<void>;
  evaluate<R, A = undefined>(
    callback: (argument: A) => R | Promise<R>,
    argument?: A,
  ): Promise<R>;
  screenshot(options: {
    path: string;
    type: "png";
    fullPage: boolean;
    animations: "disabled";
    caret: "hide";
    timeout: number;
  }): Promise<Buffer>;
  close(): Promise<void>;
}

export interface BrowserContextLike {
  newPage(): Promise<BrowserPageLike>;
  close(): Promise<void>;
}

export interface BrowserLike {
  newContext(options: {
    viewport: { width: number; height: number };
    deviceScaleFactor: number;
    colorScheme: "light" | "dark";
    javaScriptEnabled: boolean;
    reducedMotion: "reduce";
  }): Promise<BrowserContextLike>;
  close(): Promise<void>;
}

export interface ChromiumLike {
  executablePath(): string;
  launch(options: {
    executablePath: string;
    headless: true;
  }): Promise<BrowserLike>;
}

export class PreviewBrowserUnavailableError extends Error {
  readonly code:
    | "PREVIEW_BROWSER_UNAVAILABLE"
    | "PREVIEW_BROWSER_MODULE_UNAVAILABLE";

  constructor(
    code: "PREVIEW_BROWSER_UNAVAILABLE" | "PREVIEW_BROWSER_MODULE_UNAVAILABLE",
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "PreviewBrowserUnavailableError";
    this.code = code;
  }
}

function moduleChromium(value: unknown): ChromiumLike | null {
  if (!value || typeof value !== "object" || !("chromium" in value))
    return null;
  return (value as { chromium: ChromiumLike }).chromium;
}

export async function loadProjectPlaywright(): Promise<ChromiumLike> {
  const moduleName = "playwright-core";
  try {
    const loaded = await import(moduleName);
    const chromium = moduleChromium(loaded);
    if (chromium) return chromium;
  } catch {
    // Fall through to workspace-local dependency locations used before pnpm links this new package.
  }

  const thisDirectory = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(thisDirectory, "../package.json"),
    path.resolve(thisDirectory, "../../../package.json"),
    path.resolve(thisDirectory, "../../media/package.json"),
    path.resolve(thisDirectory, "../../../apps/cli/package.json"),
    path.resolve(process.cwd(), "package.json"),
    path.resolve(process.cwd(), "packages/media/package.json"),
    path.resolve(process.cwd(), "apps/cli/package.json"),
  ];
  for (const packageFile of candidates) {
    if (!existsSync(packageFile)) continue;
    try {
      const loaded = createRequire(packageFile)(moduleName) as unknown;
      const chromium = moduleChromium(loaded);
      if (chromium) return chromium;
    } catch {
      // Try the next project-local package root.
    }
  }
  throw new PreviewBrowserUnavailableError(
    "PREVIEW_BROWSER_MODULE_UNAVAILABLE",
    "The project-local playwright-core dependency is unavailable; no preview screenshots were generated.",
  );
}

async function cachedChromiumCandidates(root: string): Promise<string[]> {
  const cacheRoot = path.join(root, ".cache", "playwright");
  if (!existsSync(cacheRoot)) return [];
  const directories = await readdir(cacheRoot, { withFileTypes: true });
  return directories
    .filter(
      (entry) => entry.isDirectory() && entry.name.startsWith("chromium-"),
    )
    .map((entry) =>
      path.join(cacheRoot, entry.name, "chrome-win64", "chrome.exe"),
    )
    .sort();
}

function workspaceRoot(start: string): string {
  let current = path.resolve(start);
  while (true) {
    if (existsSync(path.join(current, "pnpm-workspace.yaml"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(start);
    current = parent;
  }
}

export async function resolveChromiumExecutable(
  chromium: ChromiumLike,
  explicitPath?: string,
): Promise<string> {
  if (explicitPath !== undefined) {
    const resolved = path.resolve(explicitPath);
    if (existsSync(resolved)) return resolved;
    throw new PreviewBrowserUnavailableError(
      "PREVIEW_BROWSER_UNAVAILABLE",
      `Configured Chromium executable does not exist: ${resolved}. No preview screenshots were generated.`,
    );
  }

  const roots = unique([
    workspaceRoot(process.cwd()),
    workspaceRoot(path.dirname(fileURLToPath(import.meta.url))),
  ]);
  const candidates = [process.env.MPFORGE_CHROMIUM_EXECUTABLE];
  try {
    candidates.push(chromium.executablePath());
  } catch {
    // The package can exist without an installed browser.
  }
  for (const root of roots)
    candidates.push(...(await cachedChromiumCandidates(root)));
  const executable = candidates.find((candidate): candidate is string =>
    Boolean(candidate && existsSync(candidate)),
  );
  if (executable) return path.resolve(executable);
  throw new PreviewBrowserUnavailableError(
    "PREVIEW_BROWSER_UNAVAILABLE",
    "Project-local Chromium was not found. Run scripts/env.ps1 and install the pinned Playwright browser before generating previews; no screenshots were generated.",
  );
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
