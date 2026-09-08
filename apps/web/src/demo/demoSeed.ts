import { buildArticleDocument } from "@mpforge/content-schema";
import type { StorageAdapter } from "../storage/StorageAdapter";

const DEMO_SLUG = "content-as-code-demo";
const ARTICLE_PATH = `content/${DEMO_SLUG}/article.md`;
const FIXED_TIME = "2026-01-01T08:00:00.000Z";
const DEMO_COVER_PATH = "assets/originals/demo-cover.svg";

const ARTICLE_BODY = `# 把公众号发文做成 Content-as-Code

传统编辑器只关心“写完了吗”，MPForge 还关心内容如何被审校、图片是否有授权、谁完成了人工批准，以及一次草稿操作能否被安全对账。

## 一条可审计的内容链路

1. 使用 Markdown 保存内容真源；
2. 运行结构与合规 Linter；
3. 为图片记录来源和授权状态；
4. 生成浅色与深色预览；
5. 由人完成批准；
6. 先在 Mock WeChat 中验证草稿、异常状态和幂等行为。

> 当前页面是纯浏览器 DEMO / MOCK，不读取真实公众号配置，也不会访问真实微信接口。
`;

export function buildDemoArticle(): string {
  return buildArticleDocument(
    {
      id: "demo-article-001",
      slug: DEMO_SLUG,
      title: "把公众号发文做成 Content-as-Code",
      summary: "从 Markdown 到可审计 Mock 草稿的安全演示",
      author: "MPForge Demo",
      account: "mock-account",
      theme: "minimal",
      status: "approved",
      cover: DEMO_COVER_PATH,
      source_url: null,
      original: true,
      ai_assisted: false,
      ai_tasks: [],
      human_reviewed: true,
      need_open_comment: true,
      only_fans_can_comment: false,
      created_at: FIXED_TIME,
      updated_at: FIXED_TIME,
      version: 1,
    },
    ARTICLE_BODY,
  );
}

const DEMO_COVER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-labelledby="title desc">
  <title id="title">MPForge Content-as-Code demo cover</title>
  <desc id="desc">An original geometric cover generated for the MPForge public demo.</desc>
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#312e81"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs>
  <rect width="1200" height="630" rx="44" fill="url(#g)"/>
  <path d="M110 150h460v330H110z" fill="#fff" opacity=".1"/><path d="M160 215h330M160 280h250M160 345h290" stroke="#fff" stroke-width="24" stroke-linecap="round" opacity=".85"/>
  <circle cx="850" cy="315" r="170" fill="#fff" opacity=".12"/><path d="M780 250h140v130H780zM815 210v210M750 315h200" stroke="#fff" stroke-width="18" fill="none" opacity=".9"/>
  <text x="110" y="555" fill="#fff" font-family="system-ui,sans-serif" font-size="58" font-weight="700">MPForge · Content-as-Code</text>
</svg>\n`;

const DEMO_FILES: Record<string, string> = {
  [ARTICLE_PATH]: buildDemoArticle(),
  [`content/${DEMO_SLUG}/${DEMO_COVER_PATH}`]: DEMO_COVER_SVG,
  [`content/${DEMO_SLUG}/build/lint-report.json`]: JSON.stringify(
    {
      schema: "mpforge.lint/v1",
      passed: true,
      summary: { errors: 0, warnings: 6, info: 0 },
      issues: [],
      error_count: 0,
      warning_count: 6,
      info_count: 0,
      publish_blocked: false,
      diagnostics: [],
      applied_fixes: [],
    },
    null,
    2,
  ),
  [`content/${DEMO_SLUG}/history/state-events.jsonl`]: `${JSON.stringify({
    event_id: "demo-event-approved",
    article_id: "demo-article-001",
    from_status: "reviewed",
    to_status: "approved",
    actor_type: "human",
    actor_id: "demo-reviewer",
    reason: "Public demo fixture",
    created_at: FIXED_TIME,
    source_commit: "demo-fixture",
  })}\n`,
  [`content/${DEMO_SLUG}/history/approvals.jsonl`]: `${JSON.stringify({
    approval_id: "demo-human-approval-001",
    article_id: "demo-article-001",
    reviewer_id: "demo-reviewer",
    reviewer_type: "human-demo-fixture",
    decision: "approved",
    created_at: FIXED_TIME,
    fixture_notice: "Mock-only public demonstration evidence",
  })}\n`,
  [`content/${DEMO_SLUG}/receipts/mock-receipt.json`]: JSON.stringify(
    {
      schema: "mpforge.mock-receipt/v1",
      operation_id: "demo-op-succeeded",
      account_alias: "mock-account",
      status: "SUCCEEDED",
      remote_draft_id: "mock-draft-demo-001",
      network_mode: "mock-only",
      created_at: FIXED_TIME,
    },
    null,
    2,
  ),
};

export async function seedPublicDemoWorkspace(
  adapter: StorageAdapter,
): Promise<boolean> {
  if (await adapter.exists(ARTICLE_PATH)) return false;
  const coverBytes = new TextEncoder().encode(DEMO_COVER_SVG);
  const coverSha256 = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", coverBytes)),
  )
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  const manifest = {
    schema_version: "1",
    article_id: "demo-article-001",
    generated_at: FIXED_TIME,
    assets: [
      {
        asset_id: `asset-${coverSha256.slice(0, 16)}`,
        original_reference: DEMO_COVER_PATH,
        local_path: DEMO_COVER_PATH,
        normalized_path: DEMO_COVER_PATH,
        source_type: "generated",
        source_url: null,
        sha256: coverSha256,
        mime_type: "image/svg+xml",
        file_size: coverBytes.byteLength,
        width: 1200,
        height: 630,
        animated: false,
        has_alpha: true,
        exif_present: false,
        gps_metadata_present: false,
        imported_at: FIXED_TIME,
        imported_by: "mpforge-demo-generator",
        rights_status: "approved",
        license: "MIT",
        creator: "MPForge contributors",
        attribution: "Original deterministic MPForge public-demo cover",
        generation_method: "Project-authored deterministic SVG",
        transformations: [],
        build_outputs: [],
        upload_status: "not_uploaded",
        warnings: [],
      },
    ],
  };
  for (const [path, content] of Object.entries(DEMO_FILES)) {
    await adapter.writeFile(path, content);
  }
  await adapter.writeFile(
    `content/${DEMO_SLUG}/assets/manifest.json`,
    JSON.stringify(manifest, null, 2),
  );
  return true;
}
