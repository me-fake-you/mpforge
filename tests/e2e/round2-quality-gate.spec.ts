import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { AssetManifest } from "../../packages/media/src/pipeline-types.ts";
import {
  REVIEW_CHECKLIST_KEYS,
  createApprovalRecord,
  evaluateApprovalEligibility,
  evaluateApprovalValidity,
  verifyApprovalChain,
  type ApprovalRequest,
  type ReviewChecklist,
  type ReviewEvidence,
} from "../../packages/review-gate/src/index.ts";

const repositoryRoot = path.resolve(__dirname, "../..");
const evidenceDirectory = path.join(
  repositoryRoot,
  "artifacts/evidence/round-2",
);
const captureRound2Evidence = process.env.MPFORGE_ROUND2_EVIDENCE === "1";
const navigationName = "MPForge workspace";
const attemptedExternalRequests = new WeakMap<Page, string[]>();
const ownedImageReference = "images/round2-project-owned.png";
const ownedImageBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAEgAAAAwCAYAAACynDzrAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAC0SURBVGhD7dCxDYNQEARReqAON0LgwmjKTbgGd4Hs9FgdGhEgIf8JXnLR7Uzzc/nq2JQH7RkIGAgYCBgIGAgYCGCgx/v113JvMlCz2UBF7k0GajYbqMi9yUDNZgMVuTcZqNlsoCL3JgM1mw1U5N5koGbzqUCjMxAwEDAQMBAwEDAQMBDAQNtnvZX872oGAgYCBgIGAgYCBgIGAhhodAYCBgIGAgYCBgIGAgYCBgIGAgYCBgI/irBJ9sMBirAAAAAASUVORK5CYII=";
const ownedImageBytes = Buffer.from(ownedImageBase64, "base64");
const ownedImageSha256 = createHash("sha256")
  .update(ownedImageBytes)
  .digest("hex");
const ownedImageLocalPath = `assets/originals/${ownedImageSha256}.png`;
const ownedImageBuildPath = `build/assets/${ownedImageSha256}-privacy-clean.png`;
const ownedFixtureTimestamp = "2026-09-01T00:00:00.000Z";

function completeChecklist(): ReviewChecklist {
  return Object.fromEntries(
    REVIEW_CHECKLIST_KEYS.map((key) => [key, true]),
  ) as ReviewChecklist;
}

function validEvidence(
  overrides: Partial<ReviewEvidence> = {},
): ReviewEvidence {
  return {
    articleId: "round-2-quality-gate",
    status: "reviewed",
    sourceHash: "source-v1",
    renderedHtmlHash: "render-v1",
    wechatHtmlHash: "wechat-v1",
    lintReportHash: "lint-v1",
    assetsManifestHash: "assets-v1",
    themeHash: "theme-v1",
    rendererVersion: "renderer/2",
    linterVersion: "linter/2",
    rulesetVersion: "wechat/2026-09",
    buildSettingsHash: "build-settings-v1",
    publishSettingsHash: "publish-settings-v1",
    lintErrorCount: 0,
    assets: [{ assetId: "asset-owned", rightsStatus: "approved" }],
    artifacts: {
      rawHtml: true,
      safeHtml: true,
      wechatHtml: true,
      lintReport: true,
      assetsManifest: true,
      previewReport: true,
    },
    buildSourceHash: "source-v1",
    lintSourceHash: "source-v1",
    lintRenderedHtmlHash: "render-v1",
    previewSourceHash: "source-v1",
    previewRenderedHtmlHash: "render-v1",
    previewWechatHtmlHash: "wechat-v1",
    ...overrides,
  };
}

function validRequest(
  overrides: Partial<ApprovalRequest> = {},
): ApprovalRequest {
  return {
    evidence: validEvidence(),
    checklist: completeChecklist(),
    actor: {
      actorType: "human",
      actorId: "round-2-human-reviewer",
      explicitHumanAction: true,
    },
    confirmedSourceHash: "source-v1",
    warningsAcknowledged: ["CONTENT_EXTERNAL_LINK"],
    sourceCommit: "round-2-source-commit",
    ...overrides,
  };
}

function blockerCodes(request: ApprovalRequest): string[] {
  return evaluateApprovalEligibility(request).blockers.map(
    (blocker) => blocker.code,
  );
}

async function openView(page: Page, name: string): Promise<void> {
  const navigation = page.getByRole("navigation", { name: navigationName });
  const destination = navigation.getByRole("button", { name });
  await destination.click();
  await expect(destination).toHaveAttribute("aria-current", "page");
}

async function replaceEditorDocument(
  page: Page,
  source: string,
): Promise<void> {
  const editor = page.locator(".cm-content");
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+A" : "Control+A",
  );
  await page.keyboard.insertText(source);
  await expect(editor).toContainText("ROUND2_UNFINISHED_PLACEHOLDER");
}

async function readWorkspaceFile(page: Page, suffix: string): Promise<string> {
  return page.evaluate(async (expectedSuffix) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("wemd-files");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const records = await new Promise<
        Array<{ path: string; content: string }>
      >((resolve, reject) => {
        const request = database
          .transaction("content", "readonly")
          .objectStore("content")
          .getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const normalizedSuffix = expectedSuffix.replace(/\\/g, "/").toLowerCase();
      return (
        records.find((record) =>
          record.path
            .replace(/\\/g, "/")
            .toLowerCase()
            .endsWith(normalizedSuffix),
        )?.content ?? ""
      );
    } finally {
      database.close();
    }
  }, suffix);
}

async function currentArticlePath(page: Page): Promise<string> {
  const articlePath = await page.evaluate(() =>
    localStorage.getItem("wemd-last-file-path"),
  );
  expect(articlePath).toMatch(/(?:^|\/)content\/[^/]+\/article\.md$/i);
  return articlePath as string;
}

function readFrontmatterString(source: string, key: string): string {
  const match = source.match(
    new RegExp(`^${key}:\\s*(?:"([^"]+)"|'([^']+)'|([^\\s#]+))\\s*$`, "m"),
  );
  const value = match?.[1] ?? match?.[2] ?? match?.[3];
  expect(value, `frontmatter ${key} must be present`).toBeTruthy();
  return value as string;
}

function createOwnedAssetManifest(articleId: string): AssetManifest {
  return {
    schema_version: "1",
    article_id: articleId,
    generated_at: ownedFixtureTimestamp,
    assets: [
      {
        asset_id: `asset-${ownedImageSha256.slice(0, 32)}`,
        original_reference: ownedImageReference,
        local_path: ownedImageLocalPath,
        normalized_path: ownedImageLocalPath,
        source_type: "user_owned",
        source_url: null,
        sha256: ownedImageSha256,
        mime_type: "image/png",
        file_size: ownedImageBytes.length,
        width: 72,
        height: 48,
        animated: false,
        has_alpha: true,
        exif_present: false,
        gps_metadata_present: false,
        imported_at: ownedFixtureTimestamp,
        imported_by: "human:round2-e2e-project-owner",
        rights_status: "approved",
        license: "MPForge project-owned test fixture",
        creator: "MPForge QA",
        attribution: "MPForge Round 2 project-owned QA fixture",
        transformations: [
          {
            type: "privacy_cleanup",
            input_sha256: ownedImageSha256,
            output_sha256: ownedImageSha256,
            output_path: ownedImageBuildPath,
            mime_type: "image/png",
            file_size: ownedImageBytes.length,
            width: 72,
            height: 48,
            privacy_metadata_removed: true,
            created_at: ownedFixtureTimestamp,
          },
        ],
        build_outputs: [
          {
            output_id: `output-${ownedImageSha256.slice(0, 32)}`,
            purpose: "article",
            path: ownedImageBuildPath,
            sha256: ownedImageSha256,
            mime_type: "image/png",
            file_size: ownedImageBytes.length,
            width: 72,
            height: 48,
          },
        ],
        upload_status: "not_uploaded",
        warnings: [],
      },
    ],
  };
}

async function seedIndexedDbFiles(
  page: Page,
  files: Array<{ path: string; content: string }>,
): Promise<void> {
  await page.evaluate(async (records) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("wemd-files");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(
          ["meta", "content"],
          "readwrite",
        );
        const meta = transaction.objectStore("meta");
        const content = transaction.objectStore("content");
        const updatedAt = new Date().toISOString();
        for (const record of records) {
          meta.put({ path: record.path, updatedAt });
          content.put(record);
        }
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  }, files);
}

async function saveJsonEvidence(name: string, value: unknown): Promise<void> {
  if (!captureRound2Evidence) return;
  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(
    path.join(evidenceDirectory, name),
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );
}

async function saveScreenshot(
  name: string,
  target: Page | Locator,
): Promise<void> {
  if (!captureRound2Evidence) return;
  await mkdir(evidenceDirectory, { recursive: true });
  await target.screenshot({
    path: path.join(evidenceDirectory, name),
    animations: "disabled",
  });
}

test.describe("Round 2 production approval boundary", () => {
  for (const actorType of [
    "agent",
    "skill",
    "mcp",
    "ci",
    "automation",
    "github_action",
  ] as const) {
    test(`${actorType} cannot create an approval`, () => {
      const request = validRequest({
        actor: {
          actorType,
          actorId: `round-2-${actorType}`,
          explicitHumanAction: true,
        },
      });

      expect(blockerCodes(request)).toContain("ACTOR_NOT_HUMAN");
      expect(() =>
        createApprovalRecord(request, {
          approvalId: `approval-${actorType}`,
          approvedAt: "2026-09-01T00:00:00.000Z",
          previousRecordHash: null,
        }),
      ).toThrow(/Approval quality gate failed/);
    });
  }

  for (const rightsStatus of ["pending", "blocked", "unknown"] as const) {
    test(`rights_status=${rightsStatus} blocks approval`, () => {
      const request = validRequest({
        evidence: validEvidence({
          assets: [{ assetId: "asset-unresolved", rightsStatus }],
        }),
      });

      expect(blockerCodes(request)).toContain("ASSET_RIGHTS_NOT_APPROVED");
      expect(() =>
        createApprovalRecord(request, {
          approvalId: `approval-rights-${rightsStatus}`,
          approvedAt: "2026-09-01T00:00:00.000Z",
          previousRecordHash: null,
        }),
      ).toThrow(/Approval quality gate failed/);
    });
  }

  const mismatches: Array<{
    name: string;
    patch: Partial<ReviewEvidence>;
    blocker: string;
  }> = [
    {
      name: "build/source",
      patch: { buildSourceHash: "stale-source" },
      blocker: "BUILD_SOURCE_MISMATCH",
    },
    {
      name: "lint/source",
      patch: { lintSourceHash: "stale-source" },
      blocker: "LINT_SOURCE_MISMATCH",
    },
    {
      name: "lint/rendered HTML",
      patch: { lintRenderedHtmlHash: "stale-render" },
      blocker: "LINT_RENDER_MISMATCH",
    },
    {
      name: "preview/source",
      patch: { previewSourceHash: "stale-source" },
      blocker: "PREVIEW_SOURCE_MISMATCH",
    },
    {
      name: "preview/rendered HTML",
      patch: { previewRenderedHtmlHash: "stale-render" },
      blocker: "PREVIEW_RENDER_MISMATCH",
    },
    {
      name: "preview/WeChat HTML",
      patch: { previewWechatHtmlHash: "stale-wechat" },
      blocker: "PREVIEW_WECHAT_MISMATCH",
    },
  ];

  for (const mismatch of mismatches) {
    test(`${mismatch.name} hash mismatch blocks approval`, () => {
      const request = validRequest({
        evidence: validEvidence(mismatch.patch),
      });
      expect(blockerCodes(request)).toContain(mismatch.blocker);
    });
  }

  test("approval record content and reviewer tampering are detected", () => {
    const record = createApprovalRecord(validRequest(), {
      approvalId: "approval-round-2-tamper-test",
      approvedAt: "2026-09-01T00:00:00.000Z",
      previousRecordHash: null,
    });
    expect(verifyApprovalChain([record])).toEqual({ valid: true, errors: [] });

    const contentTampered = { ...record, source_hash: "attacker-source" };
    const contentResult = verifyApprovalChain([contentTampered]);
    expect(contentResult.valid).toBe(false);
    expect(contentResult.errors).toContain(
      "approval[0] record_hash does not match its contents",
    );

    const reviewerTampered = {
      ...record,
      reviewer_type: "agent",
    } as unknown as typeof record;
    const reviewerResult = verifyApprovalChain([reviewerTampered]);
    expect(reviewerResult.valid).toBe(false);
    expect(reviewerResult.errors).toContain(
      "approval[0] has a non-human reviewer_type",
    );
  });

  test("a coherent source edit invalidates the old approval and returns to draft", () => {
    const record = createApprovalRecord(validRequest(), {
      approvalId: "approval-round-2-source-v1",
      approvedAt: "2026-09-01T00:00:00.000Z",
      previousRecordHash: null,
    });
    const editedEvidence = validEvidence({
      status: "approved",
      sourceHash: "source-v2",
      buildSourceHash: "source-v2",
      lintSourceHash: "source-v2",
      previewSourceHash: "source-v2",
    });

    const validity = evaluateApprovalValidity(record, editedEvidence);
    expect(validity.valid).toBe(false);
    expect(validity.reasons).toContain("source_changed");
    expect(validity.targetStatus).toBe("draft");
  });

  test("changed lint and stale preview evidence invalidate an approval", () => {
    const record = createApprovalRecord(validRequest(), {
      approvalId: "approval-round-2-evidence-v1",
      approvedAt: "2026-09-01T00:00:00.000Z",
      previousRecordHash: null,
    });
    const staleEvidence = validEvidence({
      status: "approved",
      lintReportHash: "lint-v2",
      previewRenderedHtmlHash: "stale-render",
    });

    const validity = evaluateApprovalValidity(record, staleEvidence);
    expect(validity.valid).toBe(false);
    expect(validity.reasons).toEqual(
      expect.arrayContaining(["lint_report_changed", "preview_stale"]),
    );
  });
});

test.describe("Round 2 MCP boundary", () => {
  test("the advertised MCP surface has no direct approval operation", async () => {
    const source = await readFile(
      path.join(repositoryRoot, "apps/mcp/src/server.ts"),
      "utf8",
    );
    const definitions = source.match(
      /export const TOOL_DEFINITIONS\s*=\s*\[([\s\S]*?)\]\s*as const/,
    )?.[1];
    expect(
      definitions,
      "MCP tool definitions must remain inspectable",
    ).toBeTruthy();
    const names = [
      ...(definitions ?? "").matchAll(/name:\s*["']([^"']+)["']/g),
    ].map((match) => match[1]);
    expect(names).toContain("get_approval_status");
    expect(
      names.filter((name) =>
        /^(?:approve|set_approved|grant_approval)(?:_|$)/i.test(name),
      ),
    ).toEqual([]);
  });

  test("the MCP dispatcher has no direct or disguised approval case", async () => {
    const source = await readFile(
      path.join(repositoryRoot, "apps/mcp/src/server.ts"),
      "utf8",
    );
    expect(source).not.toMatch(
      /case\s+["'](?:approve_article|approve|set_approved|grant_approval)["']/i,
    );
    expect(source).not.toMatch(/approveArticle\s*\(/);
    expect(source).toContain('throw new Error("Unknown MCP tool: " + name)');
  });
});

test.describe("Round 2 Review and Assets browser quality gate", () => {
  test.beforeEach(async ({ context, page }) => {
    await context.addInitScript(() => {
      if (sessionStorage.getItem("mpforge-round2-e2e") === "initialized") {
        return;
      }
      localStorage.clear();
      sessionStorage.clear();
      sessionStorage.setItem("mpforge-round2-e2e", "initialized");
    });

    const externalRequests: string[] = [];
    attemptedExternalRequests.set(page, externalRequests);
    await page.route(/^https?:\/\//, async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
        await route.continue();
        return;
      }
      externalRequests.push(url.toString());
      await route.abort("blockedbyclient");
    });

    await page.goto("/");
    await expect(page.getByLabel("MPForge 编辑器")).toBeVisible();
  });

  test.afterEach(async ({ page }) => {
    expect(
      attemptedExternalRequests.get(page),
      "Round 2 browser QA must not call external services",
    ).toEqual([]);
  });

  test("Review and Assets expose real blockers and keep approval locked", async ({
    page,
  }) => {
    await openView(page, "Dashboard");
    await page.getByRole("button", { name: "New article" }).click();
    await replaceEditorDocument(
      page,
      [
        "# Round 2 质量门负向验收",
        "",
        "ROUND2_UNFINISHED_PLACEHOLDER",
        "",
        "![未登记授权的本地图片](assets/rights-pending.png)",
      ].join("\n"),
    );
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+S" : "Control+S",
    );
    await expect(page.locator(".save-indicator.saved")).toBeVisible();

    await openView(page, "Review");
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(main.getByLabel("Review evidence")).toBeVisible();
    await expect(main.getByLabel("Linter findings")).toBeVisible();
    await expect(main.getByLabel("Visual previews")).toHaveCount(0);
    await expect(main.getByText(/Chromium preview required/i)).toBeVisible();
    const humanChecklist = main.getByRole("group", {
      name: "Human checklist",
    });
    await expect(humanChecklist).toBeVisible();
    await expect(humanChecklist.getByRole("checkbox")).toHaveCount(10);
    await expect(
      main.getByRole("complementary").getByRole("heading", {
        name: "Approval remains locked",
      }),
    ).toBeVisible();
    await expect(page.getByText(/AI cannot grant approval/i)).toBeVisible();
    await expect(page.getByText(/ERROR/).first()).toBeVisible();
    await expect(
      page
        .getByText(
          /asset\.rights\.unknown|rights(?:_status)?\s*[:=]?\s*(?:pending|unknown)/i,
        )
        .first(),
    ).toBeVisible();

    const approve = page.getByRole("button", {
      name: /^(?:Approve|Approve article)$/i,
    });
    await expect(approve).toBeDisabled();
    await approve.evaluate((button: HTMLButtonElement) => button.click());
    await expect(page.getByText(/Human approval recorded/i)).toHaveCount(0);
    await saveScreenshot("before-lint.png", page);

    await openView(page, "Assets");
    await expect(page.getByText(/rights-pending\.png/i).first()).toBeVisible();
    for (const field of [
      /original source|原始来源/i,
      /creator|创作者/i,
      /license|许可证/i,
      /attribution|署名/i,
      /rights_status|授权状态/i,
      /sha-?256|哈希/i,
      /privacy|metadata|隐私元数据/i,
    ]) {
      await expect(page.getByText(field).first()).toBeVisible();
    }
  });

  test("a browser build cannot synthesize Chromium evidence or unlock approval", async ({
    page,
  }) => {
    await openView(page, "Dashboard");
    await page.getByRole("button", { name: "New article" }).click();
    const editor = page.locator(".cm-content");
    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+A" : "Control+A",
    );
    await page.keyboard.insertText(
      [
        "# Round 2 approval evidence",
        "",
        "Deterministic local content ready for human review.",
        "",
        `![Project-owned Round 2 fixture](${ownedImageReference})`,
      ].join("\n"),
    );
    await expect(editor).toContainText("Deterministic local content");

    await page
      .getByRole("textbox", { name: "标题" })
      .fill("Round 2 人工批准验收");
    await page
      .getByRole("textbox", { name: "摘要" })
      .fill("Round 2 quality gate evidence");
    await page.getByRole("textbox", { name: "作者" }).fill("Luna QA");
    await page.getByRole("textbox", { name: "账号别名" }).fill("local-qa-only");
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+S" : "Control+S",
    );
    await expect(page.locator(".save-indicator.saved")).toBeVisible();

    const articlePath = await currentArticlePath(page);
    const articleDirectory = articlePath.replace(/\/article\.md$/i, "");
    const articleSource = await readWorkspaceFile(page, "/article.md");
    const articleId = readFrontmatterString(articleSource, "id");
    const ownedManifest = createOwnedAssetManifest(articleId);

    // This fixture models already-produced media/CLI output. The browser flow
    // below proves that Web consumes and gates on it; it does not claim that
    // Web performed the Node media import or privacy-cleanup transformation.
    await seedIndexedDbFiles(page, [
      {
        path: `${articleDirectory}/${ownedImageLocalPath}`,
        content: ownedImageBase64,
      },
      {
        path: `${articleDirectory}/${ownedImageBuildPath}`,
        content: ownedImageBase64,
      },
      {
        path: `${articleDirectory}/assets/manifest.json`,
        content: `${JSON.stringify(ownedManifest, null, 2)}\n`,
      },
    ]);
    for (const assetPath of [
      ownedImageReference,
      `${articleDirectory}/${ownedImageLocalPath}`,
      `${articleDirectory}/${ownedImageBuildPath}`,
    ]) {
      await page.route(`**/${assetPath}`, (route) =>
        route.fulfill({
          status: 200,
          contentType: "image/png",
          body: ownedImageBytes,
        }),
      );
    }
    await page.reload();
    await expect(page.getByLabel("MPForge 编辑器")).toBeVisible();
    await expect(page.locator(".cm-content")).toContainText(
      "Deterministic local content",
    );

    await page.getByRole("button", { name: "构建 HTML" }).click();
    await expect(page.getByRole("button", { name: "构建完成" })).toBeVisible();

    const [metadataRaw, lintRaw, manifestRaw, previewRaw] = await Promise.all([
      readWorkspaceFile(page, "/build/article.meta.json"),
      readWorkspaceFile(page, "/build/lint-report.json"),
      readWorkspaceFile(page, "/assets/manifest.json"),
      readWorkspaceFile(page, "/build/preview-report.json"),
    ]);
    expect({
      metadata: Boolean(metadataRaw),
      lint: Boolean(lintRaw),
      manifest: Boolean(manifestRaw),
      preview: Boolean(previewRaw),
    }).toEqual({ metadata: true, lint: true, manifest: true, preview: false });
    const metadata = JSON.parse(metadataRaw) as Record<string, unknown>;
    const lintReport = JSON.parse(lintRaw) as Record<string, unknown>;
    const assetsManifest = JSON.parse(manifestRaw) as AssetManifest;
    expect(lintReport.source_hash).toBe(metadata.source_hash);
    expect(lintReport.rendered_html_hash).toBe(metadata.rendered_html_hash);
    expect(
      (lintReport.summary as { errors?: number } | undefined)?.errors,
      "the persisted build lint must recognize the manifest-backed local image",
    ).toBe(0);
    expect(assetsManifest).toEqual(ownedManifest);
    expect(assetsManifest.assets[0]).toMatchObject({
      source_type: "user_owned",
      rights_status: "approved",
      imported_by: "human:round2-e2e-project-owner",
      sha256: ownedImageSha256,
      creator: "MPForge QA",
      license: "MPForge project-owned test fixture",
      attribution: "MPForge Round 2 project-owned QA fixture",
      exif_present: false,
      gps_metadata_present: false,
    });
    expect(assetsManifest.assets[0].transformations).toEqual([
      expect.objectContaining({
        type: "privacy_cleanup",
        privacy_metadata_removed: true,
        output_path: ownedImageBuildPath,
      }),
    ]);
    expect(assetsManifest.assets[0].build_outputs).toEqual([
      expect.objectContaining({
        purpose: "article",
        path: ownedImageBuildPath,
        sha256: ownedImageSha256,
      }),
    ]);
    await saveJsonEvidence("lint-report.json", lintReport);
    await saveJsonEvidence("assets-manifest.json", assetsManifest);

    await openView(page, "Assets");
    const assetCard = page.locator(".workspace-hub__asset-list article");
    await expect(assetCard).toHaveCount(1);
    await expect(assetCard).toContainText(ownedImageReference);
    await expect(assetCard).toContainText("MPForge QA");
    await expect(assetCard).toContainText("MPForge project-owned test fixture");
    await expect(assetCard).toContainText(
      "MPForge Round 2 project-owned QA fixture",
    );
    await expect(assetCard).toContainText("approved");
    await expect(assetCard).toContainText(ownedImageSha256);
    await expect(assetCard).toContainText(
      "processed · no privacy metadata detected",
    );
    await expect(assetCard).toContainText(
      `${ownedImageBytes.length} / ${ownedImageBytes.length}`,
    );
    await expect(page.getByLabel(`Asset ${ownedImageReference}`)).toBeVisible();
    await saveScreenshot("assets-panel.png", page);

    await openView(page, "Review");
    await expect(page.getByText(/Linter:\s*0 ERROR/i)).toBeVisible();
    await saveScreenshot("after-lint.png", page);

    await page.getByRole("button", { name: "Move to draft" }).click();
    await expect(
      page.getByText("Status: draft", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Request review" }).click();
    await expect(
      page.getByText("Status: reviewing", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Mark reviewed" }).click();
    await expect(
      page.getByText("Status: reviewed", { exact: true }),
    ).toBeVisible();

    await page
      .getByRole("textbox", { name: "Human reviewer ID" })
      .fill("round-2-human-reviewer");
    const checklist = page.getByRole("group", { name: "Human checklist" });
    for (const checkbox of await checklist.getByRole("checkbox").all()) {
      await checkbox.check();
    }
    const approve = page.getByRole("button", { name: "Approve article" });
    await expect(approve).toBeDisabled();
    await expect(page.getByText(/Chromium preview required/i)).toBeVisible();
    await expect(page.getByText(/Human approval recorded/i)).toHaveCount(0);
  });
});
