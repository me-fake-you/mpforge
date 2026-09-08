import { diagnostic, sortDiagnostics } from "./diagnostics.js";
import { WECHAT_PLATFORM_RULES } from "./platform-config.js";
import type { HtmlStageInput, HtmlStageReport, LintIssue } from "./types.js";

const RISKY_TAGS = [
  "script",
  "iframe",
  "object",
  "embed",
  "form",
  "input",
  "button",
  "video",
  "audio",
  "canvas",
] as const;

const KNOWN_TAGS = new Set([
  "a",
  "abbr",
  "article",
  "aside",
  "b",
  "blockquote",
  "br",
  "caption",
  "code",
  "col",
  "colgroup",
  "dd",
  "del",
  "details",
  "div",
  "dl",
  "dt",
  "em",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "i",
  "img",
  "ins",
  "kbd",
  "li",
  "main",
  "mark",
  "nav",
  "ol",
  "p",
  "pre",
  "q",
  "s",
  "section",
  "small",
  "span",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
  "svg",
  "path",
  "g",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "rect",
  "text",
  "defs",
  "lineargradient",
  "radialgradient",
  "stop",
  "title",
  "desc",
  "html",
  "head",
  "body",
  "meta",
  "link",
  "style",
  "source",
  "picture",
  "wbr",
]);

const VOID_TAGS = new Set([
  "br",
  "hr",
  "img",
  "input",
  "col",
  "meta",
  "link",
  "source",
  "wbr",
]);

function first(pattern: RegExp, value: string): RegExpExecArray | null {
  pattern.lastIndex = 0;
  return pattern.exec(value);
}

function pushMatch(
  issues: LintIssue[],
  value: string,
  pattern: RegExp,
  ruleId: string,
  severity: "ERROR" | "WARNING" | "INFO",
  category: "html" | "css" | "security" | "wechat" | "accessibility",
  message: string,
  file: string,
  suggestion: string,
  legacyCode?: string,
): void {
  const match = first(pattern, value);
  if (!match) return;
  issues.push(
    diagnostic(ruleId, severity, category, message, {
      file,
      source: value,
      index: match.index,
      suggestion,
      legacyCode,
    }),
  );
}

function inspectOneStage(
  html: string,
  css: string,
  file: string,
  phase: "raw" | "safe" | "wechat",
  viewportWidth: number,
): LintIssue[] {
  const issues: LintIssue[] = [];
  const prefix = `html.${phase}`;

  for (const tag of RISKY_TAGS) {
    pushMatch(
      issues,
      html,
      new RegExp(`<\\s*${tag}\\b`, "i"),
      `${prefix}.tag.${tag}`,
      "ERROR",
      "security",
      `Unsupported or high-risk HTML tag: <${tag}>.`,
      file,
      "Remove the interactive element or replace it with static article content.",
      phase === "raw" ? "html.tag.risky" : undefined,
    );
  }

  pushMatch(
    issues,
    html,
    /\son[a-z]+\s*=/i,
    `${prefix}.event-handler`,
    "ERROR",
    "security",
    "Inline HTML event handlers are forbidden.",
    file,
    "Remove the event attribute.",
    phase === "raw" ? "html.event-handler" : undefined,
  );
  pushMatch(
    issues,
    html,
    /(?:href|src)\s*=\s*["']?\s*javascript:/i,
    `${prefix}.javascript-url`,
    "ERROR",
    "security",
    "javascript: URLs are forbidden.",
    file,
    "Use a normal https URL or remove the link.",
  );
  pushMatch(
    issues,
    html,
    /(?:href|src)\s*=\s*["']?\s*data:/i,
    `${prefix}.data-url`,
    "ERROR",
    "security",
    "Embedded data: URLs are not accepted publication assets.",
    file,
    "Import the asset explicitly and reference its local manifest path.",
  );
  pushMatch(
    issues,
    html,
    /<script\b[^>]*\bsrc\s*=/i,
    `${prefix}.external-javascript`,
    "ERROR",
    "security",
    "External JavaScript is forbidden.",
    file,
    "Remove the script dependency.",
  );
  pushMatch(
    issues,
    html,
    /<link\b[^>]*rel\s*=\s*["']?stylesheet/i,
    `${prefix}.external-stylesheet`,
    "ERROR",
    "wechat",
    "External stylesheets are not portable to WeChat.",
    file,
    "Inline the compatible styles during the deterministic build.",
  );
  pushMatch(
    issues,
    html,
    /<(?:style|link)\b[^>]*(?:fonts?\.|font-face)|style\s*=\s*["'][^"']*font-family\s*:[^;]*(?:url|https?:)/i,
    `${prefix}.external-font`,
    "WARNING",
    "wechat",
    "External font dependency may be removed by WeChat.",
    file,
    "Use a system-font fallback stack.",
  );
  pushMatch(
    issues,
    html,
    /<svg\b[\s\S]*?(?:<script\b|\son[a-z]+\s*=|(?:href|xlink:href)\s*=\s*["']?(?:https?:|javascript:|data:))/i,
    `${prefix}.unsafe-svg`,
    "ERROR",
    "security",
    "SVG contains script, an event handler, or an external reference.",
    file,
    "Sanitize and rasterize the SVG through the media pipeline.",
  );

  const tagPattern = /<\/?\s*([a-zA-Z][\w:-]*)\b[^>]*>/g;
  for (const match of html.matchAll(tagPattern)) {
    const tag = (match[1] ?? "").toLocaleLowerCase();
    if (
      !KNOWN_TAGS.has(tag) &&
      !RISKY_TAGS.includes(tag as (typeof RISKY_TAGS)[number])
    ) {
      issues.push(
        diagnostic(
          `${prefix}.tag.unknown`,
          "WARNING",
          "wechat",
          `Unknown HTML tag <${tag}> may be removed by the compatibility downgrade.`,
          {
            file,
            source: html,
            index: match.index ?? 0,
            suggestion: "Replace it with a supported semantic HTML element.",
          },
        ),
      );
      break;
    }
  }

  const stack: Array<{ tag: string; index: number }> = [];
  for (const match of html.matchAll(tagPattern)) {
    const whole = match[0];
    const tag = (match[1] ?? "").toLocaleLowerCase();
    if (whole.startsWith("</")) {
      const top = stack[stack.length - 1];
      if (!top || top.tag !== tag) {
        issues.push(
          diagnostic(
            `${prefix}.nesting.invalid`,
            "WARNING",
            "html",
            `Unexpected closing tag </${tag}>.`,
            {
              file,
              source: html,
              index: match.index ?? 0,
              suggestion: "Correct the HTML nesting before rendering.",
            },
          ),
        );
        break;
      }
      stack.pop();
    } else if (!whole.endsWith("/>") && !VOID_TAGS.has(tag)) {
      stack.push({ tag, index: match.index ?? 0 });
    }
  }
  if (stack.length > 0) {
    const top = stack[stack.length - 1]!;
    issues.push(
      diagnostic(
        `${prefix}.nesting.unclosed`,
        "WARNING",
        "html",
        `Unclosed HTML tag <${top.tag}>.`,
        {
          file,
          source: html,
          index: top.index,
          suggestion: "Close the element explicitly.",
        },
      ),
    );
  }

  const styleText = `${css}\n${Array.from(html.matchAll(/style\s*=\s*["']([^"']*)["']/gi), (m) => m[1]).join("\n")}`;
  const cssChecks: Array<[RegExp, string, "ERROR" | "WARNING", string]> = [
    [/expression\s*\(/i, "expression", "ERROR", "CSS expression() is unsafe."],
    [/behavior\s*:/i, "behavior", "ERROR", "Legacy CSS behavior is unsafe."],
    [
      /@import\b/i,
      "external-import",
      "ERROR",
      "CSS @import is not reproducible.",
    ],
    [
      /position\s*:\s*fixed/i,
      "position-fixed",
      "WARNING",
      "position: fixed is unreliable in article content.",
    ],
    [
      /margin(?:-left|-right)?\s*:\s*-\d/i,
      "negative-margin",
      "WARNING",
      "Negative margins can move content outside the viewport.",
    ],
    [
      /(?:background|background-image)\s*:[^;]*url\(\s*["']?https?:/i,
      "remote-background",
      "ERROR",
      "Remote CSS background images are not local publication assets.",
    ],
    [
      /var\(\s*--[\w-]+\s*\)/i,
      "variable-no-fallback",
      "WARNING",
      "CSS variable has no fallback value.",
    ],
  ];
  for (const [pattern, name, severity, message] of cssChecks) {
    pushMatch(
      issues,
      styleText,
      pattern,
      `css.${phase}.${name}`,
      severity,
      name === "expression" || name === "behavior" ? "security" : "css",
      message,
      file,
      "Use an inline, static, mobile-safe CSS declaration.",
      phase === "raw" ? "css.compatibility.risky" : undefined,
    );
  }

  const fixedWidth = /(?:width|min-width)\s*:\s*(\d{3,})px/gi;
  for (const match of styleText.matchAll(fixedWidth)) {
    const width = Number(match[1]);
    if (width > viewportWidth) {
      issues.push(
        diagnostic(
          `css.${phase}.fixed-width-overflow`,
          "WARNING",
          "wechat",
          `Fixed width ${width}px exceeds the ${viewportWidth}px compatibility viewport.`,
          {
            file,
            source: styleText,
            index: match.index ?? 0,
            suggestion: "Use max-width: 100% and a fluid width.",
          },
        ),
      );
      break;
    }
  }
  pushMatch(
    issues,
    html,
    /<pre\b(?![^>]*style\s*=\s*["'][^"']*overflow-x)/i,
    `${prefix}.code-overflow`,
    "WARNING",
    "wechat",
    "Code block has no explicit horizontal-overflow fallback.",
    file,
    "Wrap the pre element with overflow-x:auto or enable line wrapping.",
  );
  pushMatch(
    issues,
    html,
    /<table\b(?![^>]*style\s*=\s*["'][^"']*(?:overflow|max-width|width\s*:\s*100%))/i,
    `${prefix}.table-overflow`,
    "WARNING",
    "wechat",
    "Table may overflow a mobile viewport.",
    file,
    "Use a scroll wrapper or a mobile table fallback.",
  );
  pushMatch(
    issues,
    html,
    /<img\b(?![^>]*(?:max-width\s*:\s*100%|width\s*=\s*["']?100%))/i,
    `${prefix}.image-max-width`,
    "WARNING",
    "wechat",
    "Image has no max-width mobile fallback.",
    file,
    "Add max-width:100%;height:auto to publication images.",
  );
  pushMatch(
    issues,
    html,
    /<img\b[^>]*(?:height\s*=\s*["']?(?:[5-9]\d{3}|\d{5,})|height\s*:\s*(?:[5-9]\d{3}|\d{5,})px)/i,
    `${prefix}.image-height`,
    "WARNING",
    "wechat",
    "Image has an unusually large fixed height.",
    file,
    "Use height:auto and verify the source dimensions.",
  );
  pushMatch(
    issues,
    styleText,
    /color\s*:\s*(#(?:000|000000|fff|ffffff))[^}]*background(?:-color)?\s*:\s*\1\b/i,
    `accessibility.${phase}.contrast`,
    "WARNING",
    "accessibility",
    "Text and background use the same color.",
    file,
    "Choose colors with sufficient light and dark mode contrast.",
  );

  return sortDiagnostics(issues);
}

function visibleText(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function inspectHtmlStages(input: HtmlStageInput): HtmlStageReport {
  const platform = input.platform ?? WECHAT_PLATFORM_RULES;
  const raw = inspectOneStage(
    input.rawHtml,
    input.css ?? "",
    input.file,
    "raw",
    platform.mobileViewportWidth,
  );
  const safe =
    input.safeHtml === undefined
      ? []
      : inspectOneStage(
          input.safeHtml,
          input.css ?? "",
          input.file,
          "safe",
          platform.mobileViewportWidth,
        );
  const wechat =
    input.wechatHtml === undefined
      ? []
      : inspectOneStage(
          input.wechatHtml,
          input.css ?? "",
          input.file,
          "wechat",
          platform.mobileViewportWidth,
        );

  if (input.safeHtml !== undefined && input.wechatHtml !== undefined) {
    const before = visibleText(input.safeHtml);
    const after = visibleText(input.wechatHtml);
    if (before.length >= 40 && after.length / before.length < 0.7) {
      wechat.push(
        diagnostic(
          "wechat.content-loss",
          "ERROR",
          "wechat",
          "Compatibility downgrade removed a substantial amount of visible text.",
          {
            file: input.file,
            excerpt: after.slice(0, 240),
            suggestion:
              "Inspect the safe and downgraded HTML; preserve key content as supported static markup.",
          },
        ),
      );
    }
  }

  return {
    raw,
    safe,
    wechat,
    diagnostics: sortDiagnostics([...raw, ...safe, ...wechat]),
  };
}
