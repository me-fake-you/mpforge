const DROP_WITH_CONTENT = [
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "form",
  "button",
  "textarea",
  "select",
  "option",
  "template",
  "noscript",
  "frame",
  "frameset",
  "foreignobject",
  "base",
  "link",
  "meta",
] as const;

const URI_ATTRIBUTES = new Set([
  "href",
  "src",
  "xlink:href",
  "action",
  "formaction",
  "poster",
]);

const decodeCodePoint = (digits: string, radix: 10 | 16): string => {
  const codePoint = Number.parseInt(digits, radix);
  return codePoint >= 0 && codePoint <= 0x10ffff
    ? String.fromCodePoint(codePoint)
    : "\ufffd";
};

const isSafeUri = (attribute: string, value: string): boolean => {
  const decoded = value
    .replace(/&#x([\da-f]{1,6});?/gi, (_whole, digits: string) =>
      decodeCodePoint(digits, 16),
    )
    .replace(/&#(\d{1,7});?/g, (_whole, digits: string) =>
      decodeCodePoint(digits, 10),
    )
    .replace(/&(?:colon);?/gi, ":")
    .replace(/&(?:tab|newline);?/gi, "");
  const normalized = decoded
    .replace(/[\u0000-\u0020\u007f]+/g, "")
    .toLowerCase();
  if (!normalized || normalized.startsWith("#")) return true;
  if (/^(?:\.\/|\.\.\/|\/)(?!\/)/.test(normalized)) return true;
  if (!/^[a-z][a-z\d+.-]*:/i.test(normalized)) return true;
  if (/^https?:/.test(normalized)) return true;
  if (attribute === "href" && /^(?:mailto|tel):/.test(normalized)) return true;
  return (
    attribute === "src" &&
    /^data:image\/(?:png|gif|jpe?g|webp|avif);base64,/.test(normalized)
  );
};

const sanitizeInlineStyle = (style: string): string => {
  if (
    /(?:expression\s*\(|@import|javascript\s*:|vbscript\s*:|behavior\s*:|-moz-binding|url\s*\()/i.test(
      style,
    )
  ) {
    return "";
  }
  return style.replace(/[<>\u0000]/g, "").trim();
};

/**
 * Deterministic allow-by-behaviour sanitizer for Markdown-produced HTML.
 * Dangerous elements are removed with their contents; active attributes and
 * executable URL schemes are removed from otherwise useful article markup.
 */
export function sanitizeHtml(input: string, keepInlineStyles = true): string {
  let html = input.replace(/\r\n?/g, "\n").replace(/\u0000/g, "");
  html = html.replace(/<!--[\s\S]*?-->/g, "");
  for (const tag of DROP_WITH_CONTENT) {
    const paired = new RegExp(
      `<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`,
      "gi",
    );
    const singleton = new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi");
    html = html.replace(paired, "").replace(singleton, "");
  }

  html = html.replace(
    /<([a-z][\w:-]*)([^<>]*?)>/gi,
    (whole, tag: string, raw: string) => {
      if (whole.startsWith("</")) return whole;
      if (
        tag.toLowerCase() === "input" &&
        !/\btype\s*=\s*["']?checkbox\b/i.test(raw)
      ) {
        return "";
      }
      const attributes: string[] = [];
      const attributePattern =
        /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
      for (const match of raw.matchAll(attributePattern)) {
        const originalName = match[1];
        const name = originalName.toLowerCase();
        let value = match[2] ?? match[3] ?? match[4];
        if (
          /^on/i.test(name) ||
          ["srcdoc", "nonce", "http-equiv"].includes(name)
        )
          continue;
        if (!keepInlineStyles && name === "style") continue;
        if (name === "style" && value !== undefined) {
          value = sanitizeInlineStyle(value);
          if (!value) continue;
        }
        if (
          URI_ATTRIBUTES.has(name) &&
          value !== undefined &&
          !isSafeUri(name, value)
        )
          continue;
        if (value === undefined) {
          attributes.push(originalName);
        } else {
          const escaped = value
            .replace(/&(?!(?:#\d+|#x[\da-f]+|[a-z][\w-]+);)/gi, "&amp;")
            .replace(/"/g, "&quot;");
          attributes.push(`${originalName}="${escaped}"`);
        }
      }
      const suffix = /\/\s*>$/.test(whole) ? " /" : "";
      return `<${tag}${attributes.length ? ` ${attributes.join(" ")}` : ""}${suffix}>`;
    },
  );

  return html.trim();
}

/** Escape HTML parsing sentinels while leaving the CSS deterministic. */
export function cssForStyleElement(css: string): string {
  return css.replace(/</g, "\\3c ").replace(/>/g, "\\3e ");
}
