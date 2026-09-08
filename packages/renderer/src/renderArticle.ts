import {
  convertCssToWeChatDarkMode,
  createMarkdownParser,
  processHtml,
} from "@wemd/core";
import {
  getOriginalTheme,
  themeCss,
  type ThemeDefinition,
  type ThemeMode,
} from "@mpforge/themes";
import { expandCssVariables } from "./cssVariables";
import { cssForStyleElement, sanitizeHtml } from "./sanitizeHtml";
import { sha256 } from "./sha256";

export const RENDERER_VERSION = "mpforge-renderer/0.2.0";

export interface RenderRequest {
  markdown: string;
  themeId?: string;
  /** Optional custom theme CSS. It replaces the registry light CSS. */
  themeCss?: string;
  /** Explicit custom dark CSS avoids heuristic conversion for dark-first themes. */
  darkCss?: string;
  /** Six-digit hex override for the registered theme's primary colour. */
  primaryColor?: string;
  /** Version recorded in the hash material for a custom theme. */
  themeVersion?: string;
  colorScheme?: ThemeMode;
  linkToFootnote?: boolean;
  tableWrap?: boolean;
  showMacBar?: boolean;
  includeSourcePosition?: boolean;
}

export interface RenderResult {
  /** Markdown-rendered fragment before MPForge's Round 2 safety stage. */
  rawHtml: string;
  /** Standalone raw document. It is evidence only and must never execute scripts. */
  rawDocumentHtml: string;
  /** Sanitized, theme-inlined WeChat-compatible fragment. */
  html: string;
  /** Compatibility alias for the sanitized fragment. */
  safeHtml: string;
  /** Effective CSS retained for previews, diagnostics, and audit evidence. */
  css: string;
  /** Standalone UTF-8 document persisted by the CLI build. */
  documentHtml: string;
  /** Compatibility alias for the sanitized standalone document. */
  safeDocumentHtml: string;
  /** Conservative local WeChat downgrade fragment. */
  wechatHtml: string;
  /** Standalone local WeChat compatibility simulation. */
  wechatDocumentHtml: string;
  wechatHtmlHash: string;
  themeId: string;
  themeVersion: string;
  sourceHash: string;
  renderedHtmlHash: string;
  themeHash: string;
  warnings: string[];
  assetReferences: string[];
  rendererVersion: string;
  hashes: {
    /** Compatibility alias for sourceHash. */
    markdown: string;
    /** SHA-256 of the effective CSS for the selected preview mode. */
    css: string;
    /** SHA-256 of the sanitized inline fragment. */
    html: string;
    /** SHA-256 of the exact standalone build document. */
    document: string;
    source: string;
    renderedHtml: string;
    theme: string;
  };
}

interface ResolvedTheme {
  id: string;
  version: string;
  primaryColor: string;
  lightCss: string;
  darkCss: string;
}

const escapeAttribute = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

const normalizeMarkdown = (markdown: string): string =>
  markdown.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");

const canonicalizeHtml = (html: string): string =>
  html.replace(/\r\n?/g, "\n").trim();

const convertLinksToFootnotes = (html: string): string => {
  const links: { text: string; url: string }[] = [];
  let counter = 1;
  const body = html.replace(
    /<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
    (match, url: string, text: string) => {
      if (!url || url.startsWith("#") || url.includes("mp.weixin.qq.com")) {
        return match;
      }
      const cleanedText = text.trim() || escapeAttribute(url);
      links.push({ text: cleanedText, url });
      return `<span class="footnote-word">${cleanedText}</span><sup class="footnote-ref">[${counter++}]</sup>`;
    },
  );
  if (!links.length) return body;
  const items = links
    .map(
      (link, index) =>
        `<div class="footnote-item"><span class="footnote-num">[${index + 1}] </span><p>${link.text}<br/>${escapeAttribute(link.url)}</p></div>`,
    )
    .join("");
  return `${body}<h3 class="footnotes-sep"></h3><section class="footnotes">${items}</section>`;
};

const collectAssetReferences = (html: string, css: string): string[] => {
  const refs = new Set<string>();
  for (const match of html.matchAll(
    /<(?:img|source)\b[^>]*\bsrc="([^"]+)"/gi,
  )) {
    refs.add(match[1]);
  }
  for (const match of css.matchAll(/url\(\s*["']?([^)'"\s]+)["']?\s*\)/gi)) {
    refs.add(match[1]);
  }
  return [...refs].sort();
};

/**
 * markdown-it-task-lists derives checkbox ids from a random value. Preserve
 * input/label association while replacing that implementation detail with a
 * stable document-order id.
 */
const normalizeTaskListIds = (html: string): string => {
  const ids = new Map<string, string>();
  let sequence = 0;
  return html.replace(
    /(\b(?:id|for)="(?:task-item-)([^"]+)")/gi,
    (match, _prefix: string, suffix: string) => {
      const original = `task-item-${suffix}`;
      let normalized = ids.get(original);
      if (!normalized) {
        normalized = `task-item-${++sequence}`;
        ids.set(original, normalized);
      }
      return match.replace(original, normalized);
    },
  );
};

const sanitizeThemeCss = (css: string, warnings: string[]): string => {
  const normalized = css
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
    .trim();
  const safe = normalized
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\\[\da-f]{1,6}\s?/gi, "")
    .replace(/@import\s+[^;]+;?/gi, "")
    .replace(/expression\s*\([^)]*\)/gi, "")
    .replace(
      /url\(\s*(["']?)\s*(?:javascript|vbscript|data\s*:\s*text\/html):[\s\S]*?\1\s*\)/gi,
      "",
    )
    .replace(/<\/?(?:script|style|iframe|object|embed)\b[^>]*>/gi, "");
  if (safe !== normalized)
    warnings.push("Unsafe constructs were removed from theme CSS");
  return safe;
};

const resolveTheme = (
  request: RenderRequest,
  warnings: string[],
): ResolvedTheme => {
  const requestedId = request.themeId || "minimal";
  const builtIn = getOriginalTheme(requestedId);
  if (request.themeCss !== undefined) {
    const suppliedLight = sanitizeThemeCss(request.themeCss, warnings);
    if (!suppliedLight)
      warnings.push("themeCss was empty; using minimal theme CSS");
    const fallback = builtIn ?? getOriginalTheme("minimal")!;
    const lightCss = suppliedLight || fallback.lightCss;
    const darkCss = request.darkCss
      ? sanitizeThemeCss(request.darkCss, warnings)
      : convertCssToWeChatDarkMode(expandCssVariables(lightCss));
    return {
      id: requestedId,
      version: request.themeVersion?.trim() || "custom/1",
      primaryColor: request.primaryColor || fallback.primaryColor,
      lightCss,
      darkCss,
    };
  }
  if (!builtIn) {
    warnings.push(`Unknown theme '${requestedId}'; using minimal`);
    const fallback = getOriginalTheme("minimal")!;
    return {
      id: fallback.id,
      version: fallback.version,
      primaryColor: fallback.primaryColor,
      lightCss: fallback.lightCss,
      darkCss: fallback.darkCss,
    };
  }
  if (request.primaryColor && !/^#[\da-f]{6}$/i.test(request.primaryColor)) {
    warnings.push(
      `Invalid primaryColor '${request.primaryColor}'; using theme default`,
    );
  }
  return {
    id: builtIn.id,
    version: builtIn.version,
    primaryColor:
      request.primaryColor && /^#[\da-f]{6}$/i.test(request.primaryColor)
        ? request.primaryColor.toLowerCase()
        : builtIn.primaryColor,
    lightCss: themeCss(builtIn, "light", request.primaryColor),
    darkCss: themeCss(builtIn, "dark", request.primaryColor),
  };
};

const buildDocument = (css: string, html: string, mode: ThemeMode): string =>
  `<!doctype html><html lang="zh-CN" data-color-scheme="${mode}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'"><meta name="viewport" content="width=device-width, initial-scale=1"><style data-mpforge-theme>${cssForStyleElement(css)}</style></head><body data-render-ready="true">${html}</body></html>`;

const appendInlineStyle = (
  attributes: string,
  declarations: string,
): string => {
  const style = /\bstyle="([^"]*)"/i.exec(attributes);
  if (style) {
    const current = style[1].trim().replace(/;?$/, ";");
    return attributes.replace(style[0], `style="${current}${declarations}"`);
  }
  return `${attributes} style="${declarations}"`;
};

/**
 * Conservative, deterministic downgrade for a local WeChat simulation. It
 * never claims to reproduce the real client and never removes visible prose.
 */
export function downgradeHtmlForWechat(html: string): string {
  let downgraded = sanitizeHtml(html, true)
    .replace(/\sposition\s*:\s*fixed\s*;?/gi, " position:relative;")
    .replace(
      /\smargin-(?:left|right)\s*:\s*-\d+(?:\.\d+)?(?:px|em|rem|%)\s*;?/gi,
      " ",
    )
    .replace(
      /\s(?:min-)?width\s*:\s*(?:[5-9]\d{2}|\d{4,})px\s*;?/gi,
      " max-width:100%;",
    )
    .replace(
      /\s(?:background|background-image)\s*:[^;]*url\([^)]*\)\s*;?/gi,
      " ",
    );

  downgraded = downgraded.replace(
    /<img\b([^>]*)>/gi,
    (_whole, attributes: string) =>
      `<img${appendInlineStyle(attributes, "max-width:100%;height:auto;")}>`,
  );
  downgraded = downgraded.replace(
    /<pre\b([^>]*)>/gi,
    (_whole, attributes: string) =>
      `<pre${appendInlineStyle(attributes, "max-width:100%;overflow-x:auto;white-space:pre-wrap;word-break:break-word;")}>`,
  );
  downgraded = downgraded.replace(
    /<table\b([^>]*)>/gi,
    (_whole, attributes: string) =>
      `<table${appendInlineStyle(attributes, "width:100%;max-width:100%;table-layout:fixed;")}>`,
  );
  return canonicalizeHtml(downgraded);
}

const themeHashMaterial = (theme: ResolvedTheme): string =>
  [
    "mpforge.theme/v1",
    theme.id,
    theme.version,
    theme.primaryColor,
    theme.lightCss,
    "-- mpforge dark css --",
    theme.darkCss,
  ].join("\n");

const markdownToHtml = (request: RenderRequest): string => {
  const parser = createMarkdownParser({
    mathRenderer: "katex",
    showMacBar: request.showMacBar === true,
    includeSourcePosition: request.includeSourcePosition === true,
  });
  const environment: Record<string, unknown> = {};
  const tokens = parser.parse(normalizeMarkdown(request.markdown), environment);

  // Canonical attribute order is the normalization stage between AST and HTML.
  const normalizeTokens = (items: typeof tokens): void => {
    for (const token of items) {
      token.attrs?.sort(([left], [right]) =>
        left === right ? 0 : left < right ? -1 : 1,
      );
      if (token.children) normalizeTokens(token.children);
    }
  };
  normalizeTokens(tokens);
  return parser.renderer.render(tokens, parser.options, environment);
};

export function renderArticle(request: RenderRequest): RenderResult {
  const warnings: string[] = [];
  const mode = request.colorScheme || "light";
  const theme = resolveTheme(request, warnings);
  const css = mode === "dark" ? theme.darkCss : theme.lightCss;

  let rawHtml = normalizeTaskListIds(markdownToHtml(request));
  if (request.linkToFootnote === true)
    rawHtml = convertLinksToFootnotes(rawHtml);
  rawHtml = canonicalizeHtml(rawHtml);
  const sanitizedAstHtml = sanitizeHtml(rawHtml, false);
  const inlined = processHtml(sanitizedAstHtml, css, true, true).replace(
    /data-tool="WeMD编辑器"/g,
    'data-tool="MPForge"',
  );
  const html = canonicalizeHtml(sanitizeHtml(inlined, true));
  if (!html) warnings.push("Renderer produced empty HTML");

  const assetReferences = collectAssetReferences(html, css);
  for (const asset of assetReferences) {
    if (/^(?:https?:)?\/\//i.test(asset)) {
      warnings.push(`External asset requires localization: ${asset}`);
    }
  }
  if (request.tableWrap === true && html.includes("table-container")) {
    warnings.push(
      "tableWrap is already represented by the deterministic table container",
    );
  }

  const documentHtml = canonicalizeHtml(buildDocument(css, html, mode));
  const rawDocumentHtml = canonicalizeHtml(buildDocument("", rawHtml, mode));
  const wechatHtml = downgradeHtmlForWechat(html);
  const wechatDocumentHtml = canonicalizeHtml(
    buildDocument(css, wechatHtml, mode),
  );
  const sourceHash = sha256(request.markdown);
  const renderedHtmlHash = sha256(documentHtml);
  const wechatHtmlHash = sha256(wechatDocumentHtml);
  const themeHash = sha256(themeHashMaterial(theme));
  const htmlHash = sha256(html);
  const cssHash = sha256(css);

  return {
    rawHtml,
    rawDocumentHtml,
    html,
    safeHtml: html,
    css,
    documentHtml,
    safeDocumentHtml: documentHtml,
    wechatHtml,
    wechatDocumentHtml,
    wechatHtmlHash,
    themeId: theme.id,
    themeVersion: theme.version,
    sourceHash,
    renderedHtmlHash,
    themeHash,
    warnings,
    assetReferences,
    rendererVersion: RENDERER_VERSION,
    hashes: {
      markdown: sourceHash,
      css: cssHash,
      html: htmlHash,
      document: renderedHtmlHash,
      source: sourceHash,
      renderedHtml: renderedHtmlHash,
      theme: themeHash,
    },
  };
}

export type { ThemeDefinition };
