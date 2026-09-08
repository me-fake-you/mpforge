export const CONTENT_DIRECTORY = "content" as const;
export const ARTICLE_FILENAME = "article.md" as const;
export const ASSETS_DIRECTORY = "assets" as const;
export const BUILD_DIRECTORY = "build" as const;
export const RECEIPTS_DIRECTORY = "receipts" as const;
export const HISTORY_DIRECTORY = "history" as const;
export const STATE_EVENTS_FILENAME = "state-events.jsonl" as const;

export interface ArticlePaths {
  slug: string;
  directory: string;
  article: string;
  history: string;
  stateEvents: string;
  /** @deprecated Use stateEvents. */
  audit: string;
  assets: string;
  build: string;
  receipts: string;
}

/** Paths are portable POSIX-style workspace-relative paths. */
export function assertValidSlug(slug: string): string {
  const value = slug.trim();
  if (
    !value ||
    value.length > 100 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
  ) {
    throw new Error("Article slug must use lowercase ASCII kebab-case");
  }
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) {
    throw new Error("Article slug is a reserved Windows path name");
  }
  return value;
}

function stableSuffix(input: string): string {
  let hash = 0x811c9dc5;
  for (const character of input) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** Generate a deterministic, URL- and Windows-safe slug. */
export function generateSlug(input: string): string {
  const normalized = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")
    .slice(0, 100)
    .replace(/-+$/g, "");
  const candidate = normalized || `article-${stableSuffix(input)}`;
  return assertValidSlug(candidate);
}

export function articlePaths(slug: string): ArticlePaths {
  const safeSlug = assertValidSlug(slug);
  const directory = `${CONTENT_DIRECTORY}/${safeSlug}`;
  return {
    slug: safeSlug,
    directory,
    article: `${directory}/${ARTICLE_FILENAME}`,
    history: `${directory}/${HISTORY_DIRECTORY}`,
    stateEvents: `${directory}/${HISTORY_DIRECTORY}/${STATE_EVENTS_FILENAME}`,
    audit: `${directory}/${HISTORY_DIRECTORY}/${STATE_EVENTS_FILENAME}`,
    assets: `${directory}/${ASSETS_DIRECTORY}`,
    build: `${directory}/${BUILD_DIRECTORY}`,
    receipts: `${directory}/${RECEIPTS_DIRECTORY}`,
  };
}

export const getArticlePaths = articlePaths;
