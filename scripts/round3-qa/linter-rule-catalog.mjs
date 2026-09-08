const MAIN_IMPLEMENTATION = "packages/linter/src/linter.ts";
const HTML_IMPLEMENTATION = "packages/linter/src/html-stages.ts";
const ERROR_TEST = "tests/round3/linter-error-rule-coverage.test.mjs";

function rule(rule_id, category, severity, implementation_file, options = {}) {
  const isError = severity === "ERROR" || severity === "ERROR/WARNING";
  return {
    rule_id,
    category,
    severity,
    deterministic: true,
    autofix: options.autofix ?? false,
    blocking: isError,
    implementation_file,
    documentation: "docs/LINTER_RULES.md",
    positive_test: isError ? `${ERROR_TEST}#positive:${rule_id}` : null,
    negative_test: isError ? `${ERROR_TEST}#negative:${rule_id}` : null,
    coverage_status: isError
      ? "positive_and_negative"
      : "non_error_direct_pair_not_required",
  };
}

const mainRules = [];
const addMain = (id, category, severity, options) =>
  mainRules.push(rule(id, category, severity, MAIN_IMPLEMENTATION, options));

for (const field of ["id", "title", "summary", "author"]) {
  addMain(`frontmatter.${field}.required`, "frontmatter", "ERROR");
}
for (const [id, severity] of [
  ["frontmatter.theme.required", "ERROR"],
  ["frontmatter.theme.unknown", "ERROR"],
  ["frontmatter.status.invalid", "ERROR"],
  ["frontmatter.slug.invalid", "ERROR"],
  ["frontmatter.slug.path-conflict", "ERROR"],
  ["frontmatter.id.path-conflict", "ERROR"],
  ["frontmatter.boolean.string", "ERROR"],
])
  addMain(id, "frontmatter", severity);
for (const field of [
  "original",
  "ai_assisted",
  "human_reviewed",
  "need_open_comment",
  "only_fans_can_comment",
])
  addMain(`frontmatter.${field}.boolean`, "frontmatter", "ERROR");
for (const [id, severity] of [
  ["frontmatter.original.required", "ERROR"],
  ["frontmatter.ai_tasks.invalid", "ERROR"],
  ["frontmatter.created_at.invalid", "ERROR"],
  ["frontmatter.updated_at.invalid", "ERROR"],
  ["frontmatter.updated_at.before-created", "ERROR"],
  ["frontmatter.account.missing", "ERROR/WARNING"],
  ["frontmatter.human-reviewed.status-conflict", "ERROR"],
  ["frontmatter.title.too-long", "ERROR"],
  ["frontmatter.author.too-long", "ERROR"],
  ["frontmatter.summary.too-long", "ERROR"],
  ["frontmatter.source-url.invalid", "ERROR"],
  ["frontmatter.source-url.too-long", "ERROR"],
  ["frontmatter.field.unknown", "INFO"],
  ["frontmatter.id.duplicate", "ERROR"],
  ["frontmatter.slug.duplicate", "ERROR"],
  ["frontmatter.approved.missing-record", "ERROR"],
])
  addMain(id, "frontmatter", severity);

for (const [id, category, severity, options] of [
  ["image.alt.missing", "accessibility", "WARNING"],
  ["image.external", "media", "ERROR"],
  ["image.embedded", "security", "ERROR"],
  ["image.local.missing", "media", "ERROR"],
  ["image.size.exceeded", "media", "WARNING"],
  ["image.dimensions.exceeded", "media", "WARNING"],
  ["image.svg.unsafe", "security", "ERROR"],
  ["frontmatter.cover.missing", "frontmatter", "ERROR/WARNING"],
  ["asset.rights.blocked", "media", "ERROR"],
  ["asset.rights.pending", "media", "WARNING"],
  ["asset.rights.unknown", "media", "WARNING"],
  ["asset.remote.source-url.missing", "media", "ERROR"],
  ["asset.attribution.missing", "media", "ERROR"],
  ["content.body.empty", "content", "ERROR"],
  ["paragraph.too-long", "content", "WARNING"],
  ["paragraph.duplicate", "content", "WARNING"],
  ["code.overflow", "content", "WARNING"],
  ["heading.level.jump", "content", "WARNING"],
  ["heading.duplicate", "content", "WARNING"],
  ["heading.body.missing", "content", "WARNING"],
  ["table.too-wide", "content", "WARNING"],
  ["markdown.code-fence.unclosed", "content", "ERROR"],
  ["heading.h1.multiple", "content", "WARNING"],
  ["paragraph.empty", "content", "INFO", { autofix: true }],
  ["whitespace.trailing", "content", "FIX_ONLY", { autofix: true }],
  ["link.target.empty", "content", "ERROR"],
  ["link.text.unrecognizable", "accessibility", "WARNING"],
  ["link.file-uri", "security", "ERROR"],
  ["link.local.missing", "content", "ERROR"],
  ["link.external", "content", "INFO"],
  ["link.external.excessive", "content", "WARNING"],
  ["footnote.reference.missing", "content", "WARNING"],
  ["quote.incomplete", "content", "WARNING"],
  ["markdown.structure.suspicious", "content", "WARNING"],
  ["content.placeholder", "content", "ERROR"],
  ["path.absolute.local", "security", "ERROR"],
  ["path.machine-residue", "security", "ERROR"],
  ["secret.possible", "security", "ERROR"],
  ["content.debug-residue", "content", "WARNING"],
  ["content.test-residue", "content", "WARNING"],
  ["content.unbroken-run", "content", "WARNING"],
  ["content.ai-residue.possible", "content", "WARNING"],
  ["content.length.exceeded", "wechat", "ERROR"],
  ["content.bytes.exceeded", "wechat", "ERROR"],
  ["build.determinism.unverified", "build", "WARNING"],
  ["build.nondeterministic", "build", "ERROR"],
])
  addMain(id, category, severity, options);

const htmlRules = [];
const addHtml = (id, category, severity) =>
  htmlRules.push(rule(id, category, severity, HTML_IMPLEMENTATION));
const phases = ["raw", "safe", "wechat"];
const riskyTags = [
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
];

for (const phase of phases) {
  for (const tag of riskyTags) {
    addHtml(`html.${phase}.tag.${tag}`, "security", "ERROR");
  }
  for (const [suffix, category, severity] of [
    ["event-handler", "security", "ERROR"],
    ["javascript-url", "security", "ERROR"],
    ["data-url", "security", "ERROR"],
    ["external-javascript", "security", "ERROR"],
    ["external-stylesheet", "wechat", "ERROR"],
    ["external-font", "wechat", "WARNING"],
    ["unsafe-svg", "security", "ERROR"],
    ["tag.unknown", "wechat", "WARNING"],
    ["nesting.invalid", "html", "WARNING"],
    ["nesting.unclosed", "html", "WARNING"],
  ])
    addHtml(`html.${phase}.${suffix}`, category, severity);
  for (const [suffix, category, severity] of [
    ["expression", "security", "ERROR"],
    ["behavior", "security", "ERROR"],
    ["external-import", "css", "ERROR"],
    ["position-fixed", "css", "WARNING"],
    ["negative-margin", "css", "WARNING"],
    ["remote-background", "css", "ERROR"],
    ["variable-no-fallback", "css", "WARNING"],
    ["fixed-width-overflow", "wechat", "WARNING"],
  ])
    addHtml(`css.${phase}.${suffix}`, category, severity);
  for (const suffix of [
    "code-overflow",
    "table-overflow",
    "image-max-width",
    "image-height",
  ])
    addHtml(`html.${phase}.${suffix}`, "wechat", "WARNING");
  addHtml(`accessibility.${phase}.contrast`, "accessibility", "WARNING");
}
addHtml("wechat.content-loss", "wechat", "ERROR");

export const linterRuleCatalog = [...mainRules, ...htmlRules].sort((a, b) =>
  a.rule_id.localeCompare(b.rule_id),
);
