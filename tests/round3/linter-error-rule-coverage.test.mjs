import assert from "node:assert/strict";
import test from "node:test";
import {
  inspectHtmlStages,
  lintArticle,
  WECHAT_PLATFORM_RULES,
} from "../../packages/linter/dist/index.js";
import { linterRuleCatalog } from "../../scripts/round3-qa/linter-rule-catalog.mjs";

function baseInput() {
  return {
    articlePath: "content/coverage/article.md",
    articleId: "coverage-id",
    articleSlug: "coverage",
    frontmatter: {
      schema_version: 1,
      version: 1,
      id: "coverage-id",
      slug: "coverage",
      title: "Coverage article",
      summary: "A reviewed and intentionally safe coverage fixture.",
      author: "MPForge",
      account: "mock-account",
      theme: "minimal",
      status: "reviewed",
      cover: "assets/cover.png",
      source_url: null,
      original: true,
      ai_assisted: false,
      ai_tasks: [],
      human_reviewed: true,
      need_open_comment: true,
      only_fans_can_comment: false,
      created_at: "2026-09-01T00:00:00.000Z",
      updated_at: "2026-09-01T00:00:00.000Z",
    },
    markdown: "# Coverage article\n\nReviewed publication content.",
    assets: [
      {
        reference: "assets/cover.png",
        exists: true,
        sizeBytes: 1024,
        width: 900,
        height: 500,
        sha256: "coverage-sha",
        sourceType: "user_owned",
        rightsStatus: "approved",
        license: "User-owned",
      },
    ],
    determinism: { firstHtmlHash: "same", secondHtmlHash: "same" },
    approvalRecordExists: true,
  };
}

function platform(overrides) {
  return { ...WECHAT_PLATFORM_RULES, ...overrides };
}

function mutateFrontmatter(input, field, value) {
  input.frontmatter = { ...input.frontmatter, [field]: value };
}

const mainCases = new Map();
for (const field of ["id", "title", "summary", "author"]) {
  mainCases.set(`frontmatter.${field}.required`, (input) =>
    mutateFrontmatter(input, field, ""),
  );
}
mainCases.set("frontmatter.theme.required", (input) =>
  mutateFrontmatter(input, "theme", ""),
);
mainCases.set("frontmatter.theme.unknown", (input) =>
  mutateFrontmatter(input, "theme", "unknown-theme"),
);
mainCases.set("frontmatter.status.invalid", (input) =>
  mutateFrontmatter(input, "status", "done"),
);
mainCases.set("frontmatter.slug.invalid", (input) =>
  mutateFrontmatter(input, "slug", "Bad Slug"),
);
mainCases.set("frontmatter.slug.path-conflict", (input) =>
  mutateFrontmatter(input, "slug", "other"),
);
mainCases.set("frontmatter.id.path-conflict", (input) =>
  mutateFrontmatter(input, "id", "other-id"),
);
mainCases.set("frontmatter.boolean.string", (input) =>
  mutateFrontmatter(input, "ai_assisted", "false"),
);
for (const field of [
  "original",
  "ai_assisted",
  "human_reviewed",
  "need_open_comment",
  "only_fans_can_comment",
])
  mainCases.set(`frontmatter.${field}.boolean`, (input) =>
    mutateFrontmatter(input, field, 1),
  );
mainCases.set("frontmatter.original.required", (input) => {
  delete input.frontmatter.original;
});
mainCases.set("frontmatter.ai_tasks.invalid", (input) =>
  mutateFrontmatter(input, "ai_tasks", [1]),
);
mainCases.set("frontmatter.created_at.invalid", (input) =>
  mutateFrontmatter(input, "created_at", "not-a-date"),
);
mainCases.set("frontmatter.updated_at.invalid", (input) =>
  mutateFrontmatter(input, "updated_at", "not-a-date"),
);
mainCases.set("frontmatter.updated_at.before-created", (input) => {
  mutateFrontmatter(input, "created_at", "2026-09-02T00:00:00.000Z");
});
mainCases.set("frontmatter.account.missing", (input) =>
  mutateFrontmatter(input, "account", ""),
);
mainCases.set("frontmatter.human-reviewed.status-conflict", (input) =>
  mutateFrontmatter(input, "human_reviewed", false),
);
mainCases.set("frontmatter.title.too-long", (input) =>
  mutateFrontmatter(input, "title", "T".repeat(33)),
);
mainCases.set("frontmatter.author.too-long", (input) =>
  mutateFrontmatter(input, "author", "A".repeat(17)),
);
mainCases.set("frontmatter.summary.too-long", (input) =>
  mutateFrontmatter(input, "summary", "S".repeat(121)),
);
mainCases.set("frontmatter.source-url.invalid", (input) =>
  mutateFrontmatter(input, "source_url", "file:///private"),
);
mainCases.set("frontmatter.source-url.too-long", (input) => {
  mutateFrontmatter(input, "source_url", "https://example.test/long");
  input.platform = platform({ maxSourceUrlBytes: 10 });
});
mainCases.set("frontmatter.id.duplicate", (input) => {
  input.projectArticles = [
    {
      id: "coverage-id",
      slug: "other",
      articlePath: "content/other/article.md",
    },
  ];
});
mainCases.set("frontmatter.slug.duplicate", (input) => {
  input.projectArticles = [
    {
      id: "other-id",
      slug: "coverage",
      articlePath: "content/other/article.md",
    },
  ];
});
mainCases.set("frontmatter.approved.missing-record", (input) => {
  mutateFrontmatter(input, "status", "approved");
  input.approvalRecordExists = false;
});
mainCases.set("image.external", (input) => {
  input.markdown += "\n\n![remote](https://example.test/image.png)";
});
mainCases.set("image.embedded", (input) => {
  input.markdown += "\n\n![embedded](data:image/png;base64,AAAA)";
});
mainCases.set("image.local.missing", (input) => {
  input.markdown += "\n\n![missing](assets/missing.png)";
});
mainCases.set("image.svg.unsafe", (input) => {
  input.markdown += "\n\n![unsafe](assets/unsafe.svg)";
  input.assets.push({
    reference: "assets/unsafe.svg",
    exists: true,
    unsafeSvg: true,
    rightsStatus: "approved",
  });
});
mainCases.set("frontmatter.cover.missing", (input) => {
  input.assets = [];
});
mainCases.set("asset.rights.blocked", (input) => {
  input.assets[0].rightsStatus = "blocked";
});
mainCases.set("asset.remote.source-url.missing", (input) => {
  input.assets[0].sourceType = "remote";
  input.assets[0].sourceUrl = null;
});
mainCases.set("asset.attribution.missing", (input) => {
  input.assets[0].requiresAttribution = true;
  input.assets[0].attribution = null;
});
mainCases.set("content.body.empty", (input) => {
  input.markdown = "";
});
mainCases.set("markdown.code-fence.unclosed", (input) => {
  input.markdown = "# Code\n\n```text\nunclosed";
});
mainCases.set("link.target.empty", (input) => {
  input.markdown += "\n\n[empty]()";
});
mainCases.set("link.file-uri", (input) => {
  input.markdown += "\n\n[local](file:///private/example.txt)";
});
mainCases.set("link.local.missing", (input) => {
  input.markdown += "\n\n[missing](assets/missing.txt)";
});
mainCases.set("content.placeholder", (input) => {
  input.markdown += "\n\nTODO";
});
mainCases.set("path.absolute.local", (input) => {
  input.markdown += "\n\nC:\\Users\\coverage\\private.png";
});
mainCases.set("path.machine-residue", (input) => {
  input.markdown += "\n\nAppData\\Local\\fixture";
});
mainCases.set("secret.possible", (input) => {
  input.markdown += `\n\napi_key=${"Z".repeat(32)}`;
});
mainCases.set("content.length.exceeded", (input) => {
  input.platform = platform({
    maxContentCharacters: 10,
    maxContentBytes: 1_000_000,
  });
});
mainCases.set("content.bytes.exceeded", (input) => {
  input.platform = platform({
    maxContentCharacters: 1_000_000,
    maxContentBytes: 10,
  });
});
mainCases.set("build.nondeterministic", (input) => {
  input.determinism = { firstHtmlHash: "one", secondHtmlHash: "two" };
});

function stageInput() {
  return {
    file: "content/coverage/article.md",
    rawHtml: "<p>Safe text</p>",
    safeHtml: "<p>Safe text</p>",
    wechatHtml: "<p>Safe text</p>",
    css: "p{max-width:100%;color:#222;background:#fff}",
  };
}

function withStagePayload(phase, payload) {
  const input = stageInput();
  input[`${phase}Html`] = payload;
  return input;
}

const stageCases = new Map();
const phases = ["raw", "safe", "wechat"];
const tags = [
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
  for (const tag of tags) {
    stageCases.set(`html.${phase}.tag.${tag}`, () =>
      withStagePayload(phase, `<${tag}>unsafe</${tag}>`),
    );
  }
  for (const [suffix, payload] of [
    ["event-handler", '<p onclick="unsafe()">text</p>'],
    ["javascript-url", '<a href="javascript:unsafe()">text</a>'],
    ["data-url", '<img src="data:image/png;base64,AAAA">'],
    [
      "external-javascript",
      '<script src="https://example.test/x.js"></script>',
    ],
    [
      "external-stylesheet",
      '<link rel="stylesheet" href="https://example.test/x.css">',
    ],
    [
      "unsafe-svg",
      '<svg><image href="https://example.test/x.png"></image></svg>',
    ],
  ])
    stageCases.set(`html.${phase}.${suffix}`, () =>
      withStagePayload(phase, payload),
    );
  for (const [suffix, css] of [
    ["expression", "p{width:expression(1)}"],
    ["behavior", "p{behavior:url(x)}"],
    ["external-import", '@import url("https://example.test/x.css");'],
    ["remote-background", "p{background:url(https://example.test/x.png)}"],
  ])
    stageCases.set(`css.${phase}.${suffix}`, () => ({ ...stageInput(), css }));
}
stageCases.set("wechat.content-loss", () => ({
  ...stageInput(),
  safeHtml: `<p>${"reviewed text ".repeat(20)}</p>`,
  wechatHtml: "<p>short</p>",
}));

const blockingRules = linterRuleCatalog.filter((entry) => entry.blocking);
const caseIds = [...mainCases.keys(), ...stageCases.keys()].sort();
assert.deepEqual(
  caseIds,
  blockingRules.map((entry) => entry.rule_id).sort(),
  "case registry and blocking inventory must match exactly",
);

for (const { rule_id: ruleId } of blockingRules) {
  test(`positive:${ruleId}`, () => {
    const mutate = mainCases.get(ruleId);
    const diagnostics = mutate
      ? (() => {
          const input = baseInput();
          mutate(input);
          return lintArticle(input).diagnostics;
        })()
      : inspectHtmlStages(stageCases.get(ruleId)()).diagnostics;
    assert.ok(
      diagnostics.some((entry) => entry.rule_id === ruleId),
      `${ruleId} was not emitted`,
    );
  });

  test(`negative:${ruleId}`, () => {
    const diagnostics = mainCases.has(ruleId)
      ? lintArticle(baseInput()).diagnostics
      : inspectHtmlStages(stageInput()).diagnostics;
    assert.equal(
      diagnostics.some((entry) => entry.rule_id === ruleId),
      false,
      `${ruleId} appeared in safe input`,
    );
  });
}
