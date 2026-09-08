import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { buildArticleDocument } from "@mpforge/content-schema";
import {
  buildAssetInventory,
  buildWorkbenchEvidence,
} from "../../services/mpforgeWorkbench";

const source = buildArticleDocument(
  {
    id: "workbench-test",
    title: "Workbench evidence",
    summary: "A complete deterministic fixture.",
    author: "MPForge QA",
    account: "qa-account",
    theme: "academic-blue",
    status: "reviewed",
    cover: "assets/cover.png",
    original: true,
    ai_assisted: false,
    ai_tasks: [],
    human_reviewed: true,
    need_open_comment: true,
    only_fans_can_comment: false,
    created_at: "2026-08-31T00:00:00.000Z",
    updated_at: "2026-08-31T00:00:00.000Z",
  },
  "# Verified article\n\nDeterministic local content.\n",
);

const releaseFixtureRoot = path.resolve(
  process.cwd(),
  "../../content/release-ready-article",
);

describe("MPForge workbench evidence", () => {
  it.skipIf(!existsSync(releaseFixtureRoot))(
    "keeps the checked-in release fixture bound to clean current evidence",
    () => {
      const fixtureRoot = releaseFixtureRoot;
      const articlePath = path.join(fixtureRoot, "article.md");
      const source = readFileSync(articlePath, "utf8");
      const manifest = readFileSync(
        path.join(fixtureRoot, "assets/manifest.json"),
        "utf8",
      );
      const approvalRecords = readFileSync(
        path.join(fixtureRoot, "history/approvals.jsonl"),
        "utf8",
      );
      const approvalInvalidations = readFileSync(
        path.join(fixtureRoot, "history/approval-invalidations.jsonl"),
        "utf8",
      );
      const fixtureFiles = [
        "assets/release-ready-cover.svg",
        "assets/originals/13dd9c93b06d81a787268b3322d274feecf2589d49365ce7e699dde9309afc28.svg",
        "build/assets/f438a30ae4ddaf2c830b961ffa98030a528a9193f035bf37ef71202209a9543c.png",
      ].map((relativePath) => {
        const absolutePath = path.join(fixtureRoot, relativePath);
        const stat = statSync(absolutePath);
        return {
          name: path.basename(absolutePath),
          path: absolutePath,
          createdAt: stat.birthtime,
          updatedAt: stat.mtime,
          size: stat.size,
        };
      });

      const evidence = buildWorkbenchEvidence({
        articlePath,
        source,
        files: fixtureFiles,
        assetManifest: manifest,
        approvalRecords,
        approvalInvalidations,
      });
      const preview = JSON.parse(
        readFileSync(
          path.join(fixtureRoot, "build/preview-report.json"),
          "utf8",
        ),
      ) as { source_hash: string; rendered_html_hash: string };

      expect(
        evidence.lint?.issues
          .filter((issue) => issue.severity === "ERROR")
          .map((issue) => issue.code),
      ).toEqual([]);
      expect(evidence.sourceHash).toBe(preview.source_hash);
      expect(evidence.light?.renderedHtmlHash).toBe(preview.rendered_html_hash);
    },
  );

  it("builds light/dark previews and a clean draft gate", () => {
    const evidence = buildWorkbenchEvidence({
      articlePath: "content/evidence/article.md",
      source,
      files: [
        {
          name: "cover.png",
          path: "content/evidence/assets/cover.png",
          createdAt: new Date("2026-08-31T00:00:00.000Z"),
          updatedAt: new Date("2026-08-31T00:00:00.000Z"),
          size: 128,
        },
      ],
    });

    expect(evidence.available).toBe(true);
    expect(evidence.status).toBe("reviewed");
    expect(evidence.theme).toBe("academic-blue");
    expect(evidence.lint?.summary.errors).toBe(0);
    expect(evidence.light?.documentHtml).toContain('data-color-scheme="light"');
    expect(evidence.dark?.documentHtml).toContain('data-color-scheme="dark"');
    expect(evidence.reviewReady).toBe(true);
    expect(evidence.draftReady).toBe(false);
  });

  it("blocks a missing local image", () => {
    const evidence = buildWorkbenchEvidence({
      articlePath: "content/evidence/article.md",
      source: source.replace(
        "Deterministic local content.",
        "Deterministic local content.\n\n![diagram](assets/missing.png)",
      ),
    });

    expect(evidence.draftReady).toBe(false);
    expect(
      evidence.lint?.issues.some(
        (issue) => issue.code === "image.local.missing",
      ),
    ).toBe(true);
  });

  it("binds an approved manifest asset to the workspace inventory", () => {
    const assets = buildAssetInventory(
      "content/evidence/article.md",
      "![owned](assets/originals/owned.png)",
      [
        {
          name: "owned.png",
          path: "content/evidence/assets/originals/owned.png",
          createdAt: new Date("2026-08-31T00:00:00.000Z"),
          updatedAt: new Date("2026-08-31T00:00:00.000Z"),
          size: 287,
        },
      ],
      JSON.stringify({
        assets: [
          {
            original_reference: "assets/originals/owned.png",
            local_path: "assets/originals/owned.png",
            source_type: "user_owned",
            sha256: "a".repeat(64),
            mime_type: "image/png",
            file_size: 287,
            rights_status: "approved",
            license: "User-owned",
            creator: "Human QA",
            attribution: "Human QA",
          },
        ],
      }),
    );

    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({
      exists: true,
      rightsStatus: "approved",
      sourceType: "user_owned",
      sha256: "a".repeat(64),
    });
  });

  it("shows imported manifest assets even before Markdown references them", () => {
    const assets = buildAssetInventory(
      "content/evidence/article.md",
      "No image reference yet.",
      [
        {
          name: "owned.png",
          path: "content/evidence/assets/originals/owned.png",
          createdAt: new Date("2026-08-31T00:00:00.000Z"),
          updatedAt: new Date("2026-08-31T00:00:00.000Z"),
          size: 287,
        },
      ],
      JSON.stringify({
        assets: [
          {
            asset_id: `asset-${"a".repeat(24)}`,
            original_reference: "selected:owned.png",
            local_path: "assets/originals/owned.png",
            source_type: "user_owned",
            sha256: "a".repeat(64),
            mime_type: "image/png",
            file_size: 287,
            rights_status: "pending",
          },
        ],
      }),
    );

    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({
      assetId: `asset-${"a".repeat(24)}`,
      reference: "selected:owned.png",
      exists: true,
      rightsStatus: "pending",
    });
  });
});
