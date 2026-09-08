import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { approvalSourceHash } from "./source.js";
import { prettyStableJson, sha256, stableJson } from "./crypto.js";

const CHECKLIST = {
  content_read: true,
  title_summary_confirmed: true,
  facts_citations_checked: true,
  image_sources_checked: true,
  image_rights_checked: true,
  mobile_preview_checked: true,
  dark_mode_checked: true,
  account_confirmed: true,
  no_sensitive_information: true,
  no_unfinished_placeholders: true,
};

export interface FixtureOptions {
  status?: string;
  lintErrors?: number;
  rightsStatus?: string;
  sourceCommit?: string;
}

export async function createReleaseFixture(
  workspaceRoot: string,
  options: FixtureOptions = {},
): Promise<{ articleDirectory: string; sourceCommit: string }> {
  const sourceCommit = options.sourceCommit ?? "abc123";
  const articleDirectory = path.join(workspaceRoot, "content", "release");
  await Promise.all([
    mkdir(path.join(articleDirectory, "build"), { recursive: true }),
    mkdir(path.join(articleDirectory, "assets", "originals"), {
      recursive: true,
    }),
    mkdir(path.join(articleDirectory, "history"), { recursive: true }),
  ]);
  const article = `---
id: "article-1"
title: "Approved fixture"
status: "${options.status ?? "approved"}"
cover: "assets/originals/body.png"
human_reviewed: true
updated_at: "2026-09-01T00:00:00.000Z"
version: 2
---

# Approved fixture

Original project-owned content.

![Project-owned diagram](assets/originals/body.png)
`;
  const sourceHash = approvalSourceHash(article);
  const rendered =
    '<article><h1>Approved fixture</h1><img src="assets/originals/body.png"></article>';
  const compatible =
    '<section><h1>Approved fixture</h1><img src="assets/originals/body.png"></section>';
  const renderedHash = sha256(rendered);
  const compatibleHash = sha256(compatible);
  const assetBytes = Buffer.from("fixture-image-bytes", "utf8");
  const assetHash = sha256(assetBytes);
  const manifest = {
    schema_version: "1",
    article_id: "article-1",
    assets: [
      {
        asset_id: "asset-body",
        original_reference: "assets/originals/body.png",
        local_path: "assets/originals/body.png",
        normalized_path: "assets/originals/body.png",
        source_type: "generated",
        source_url: null,
        sha256: assetHash,
        mime_type: "image/png",
        file_size: assetBytes.byteLength,
        creator: "MPForge tests",
        license: "MIT",
        attribution: "Project-generated test fixture",
        rights_status: options.rightsStatus ?? "approved",
        transformations: [],
        build_outputs: [],
      },
    ],
  };
  const manifestRaw = prettyStableJson(manifest);
  const lint = {
    schema: "mpforge.lint/v1",
    article_id: "article-1",
    source_hash: sourceHash,
    rendered_html_hash: renderedHash,
    error_count: options.lintErrors ?? 0,
    summary: { errors: options.lintErrors ?? 0, warnings: 0, info: 0 },
    issues: [],
  };
  const lintRaw = prettyStableJson(lint);
  const preview = {
    schema: "mpforge.preview/v1",
    article_id: "article-1",
    source_hash: sourceHash,
    rendered_html_hash: renderedHash,
    stage_hashes: {
      raw: renderedHash,
      safe: renderedHash,
      wechat: compatibleHash,
    },
    screenshot: ["preview-wechat-light.png"],
  };
  const previewRaw = prettyStableJson(preview);
  const meta = {
    schema: "mpforge.build/v2",
    article_id: "article-1",
    source_hash: sourceHash,
    rendered_html_hash: renderedHash,
    wechat_html_hash: compatibleHash,
    theme_hash: sha256("minimal-theme"),
  };
  const approvalUnsigned = {
    approval_id: "approval-1",
    article_id: "article-1",
    reviewer_id: "fixture-human",
    reviewer_type: "human",
    approved_at: "2026-09-01T00:00:00.000Z",
    source_hash: sourceHash,
    rendered_html_hash: renderedHash,
    wechat_html_hash: compatibleHash,
    lint_report_hash: sha256(lintRaw),
    assets_manifest_hash: sha256(manifestRaw),
    theme_hash: meta.theme_hash,
    renderer_version: "renderer/1",
    linter_version: "linter/1",
    ruleset_version: "rules/1",
    build_settings_hash: sha256("build"),
    publish_settings_hash: sha256("draft-settings"),
    checklist: CHECKLIST,
    warnings_acknowledged: [],
    source_commit: sourceCommit,
    result: "approved",
    previous_record_hash: null,
  };
  const approval = {
    ...approvalUnsigned,
    record_hash: sha256(stableJson(approvalUnsigned)),
  };
  await Promise.all([
    writeFile(path.join(articleDirectory, "article.md"), article, "utf8"),
    writeFile(
      path.join(articleDirectory, "build", "article.wechat.html"),
      compatible,
      "utf8",
    ),
    writeFile(
      path.join(articleDirectory, "build", "article.safe.html"),
      rendered,
      "utf8",
    ),
    writeFile(
      path.join(articleDirectory, "build", "article.meta.json"),
      prettyStableJson(meta),
      "utf8",
    ),
    writeFile(
      path.join(articleDirectory, "build", "lint-report.json"),
      lintRaw,
      "utf8",
    ),
    writeFile(
      path.join(articleDirectory, "build", "preview-report.json"),
      previewRaw,
      "utf8",
    ),
    writeFile(
      path.join(articleDirectory, "assets", "manifest.json"),
      manifestRaw,
      "utf8",
    ),
    writeFile(
      path.join(articleDirectory, "assets", "originals", "body.png"),
      assetBytes,
    ),
    writeFile(
      path.join(articleDirectory, "history", "approvals.jsonl"),
      `${JSON.stringify(approval)}\n`,
      "utf8",
    ),
    writeFile(
      path.join(articleDirectory, "history", "approval-invalidations.jsonl"),
      "",
      "utf8",
    ),
  ]);
  return { articleDirectory, sourceCommit };
}
