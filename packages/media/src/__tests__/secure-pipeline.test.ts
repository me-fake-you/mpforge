import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertSafeRemoteImageUrl,
  importLocalAsset,
  importRemoteAsset,
  inspectImageBytes,
  optimizeArticleAssets,
  readAssetManifest,
  scanArticleAssets,
  scanMarkdownImageReferences,
  securelyFetchRemoteImage,
  updateAssetRights,
  validateAssetManifest,
  verifyAssetRights,
  type AssetManifest,
  type DerivedImageProcessor,
  type SecureRemoteFetcher,
} from "../index.js";

const roots: string[] = [];

async function makeArticle(markdown = "# Article\n"): Promise<string> {
  const base = path.resolve(process.cwd(), "tmp", "secure-media-tests");
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, "article-"));
  roots.push(root);
  await mkdir(path.join(root, "images"));
  await writeFile(path.join(root, "article.md"), markdown);
  return root;
}

function png(width = 1, height = 1, colorType = 6): Buffer {
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XkP7WQAAAABJRU5ErkJggg==",
    "base64",
  );
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes[25] = colorType;
  return bytes;
}

function jpegWithGps(width = 2, height = 3): Buffer {
  const tiff = Buffer.alloc(8 + 2 + 12 + 4);
  tiff.write("II", 0, "ascii");
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x8825, 10);
  tiff.writeUInt16LE(4, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt32LE(22, 18);
  const appPayload = Buffer.concat([Buffer.from("Exif\0\0", "ascii"), tiff]);
  const app = Buffer.alloc(appPayload.length + 4);
  app[0] = 0xff;
  app[1] = 0xe1;
  app.writeUInt16BE(appPayload.length + 2, 2);
  appPayload.copy(app, 4);
  const sofPayload = Buffer.alloc(15);
  sofPayload[0] = 8;
  sofPayload.writeUInt16BE(height, 1);
  sofPayload.writeUInt16BE(width, 3);
  sofPayload[5] = 3;
  const sof = Buffer.alloc(19);
  sof[0] = 0xff;
  sof[1] = 0xc0;
  sof.writeUInt16BE(17, 2);
  sofPayload.copy(sof, 4);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    app,
    sof,
    Buffer.from([0xff, 0xd9]),
  ]);
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("manifest-driven local imports", () => {
  it("copies immutable originals, writes all manifest fields, and deduplicates by SHA-256", async () => {
    const article = await makeArticle(
      "![owned](images/one.png)\n![same](images/two.png)\n",
    );
    const bytes = png();
    await writeFile(path.join(article, "images", "one.png"), bytes);
    await writeFile(path.join(article, "images", "two.png"), bytes);
    const first = await importLocalAsset(article, "images/one.png", {
      importedBy: "human:test",
      sourceType: "user_owned",
      userOwnedConfirmed: true,
      rightsStatus: "pending",
      creator: "Fixture author",
      license: "user-owned",
    });
    const second = await importLocalAsset(article, "images/two.png", {
      importedBy: "human:test",
      sourceType: "user_owned",
      userOwnedConfirmed: true,
    });
    const digest = createHash("sha256").update(bytes).digest("hex");
    expect(first.asset.normalized_path).toBe(`assets/originals/${digest}.png`);
    expect(first.asset).toMatchObject({
      original_reference: "images/one.png",
      source_type: "user_owned",
      source_url: null,
      mime_type: "image/png",
      file_size: bytes.byteLength,
      width: 1,
      height: 1,
      animated: false,
      has_alpha: true,
      exif_present: false,
      gps_metadata_present: false,
      rights_status: "pending",
      upload_status: "not_uploaded",
    });
    expect(second.deduplicated).toBe(true);
    expect(second.manifest.assets).toHaveLength(1);
    expect(
      await readFile(
        path.join(article, ...first.asset.normalized_path.split("/")),
      ),
    ).toEqual(bytes);
    expect(second.asset.warnings).toContain("DUPLICATE_CONTENT");
  });

  it("rejects traversal, symlink escape, disguised MIME, corrupt data, and pixel bombs", async () => {
    const article = await makeArticle();
    await expect(
      importLocalAsset(article, "../escape.png", { importedBy: "human:test" }),
    ).rejects.toMatchObject({ code: "PATH_TRAVERSAL" });
    await writeFile(path.join(article, "images", "fake.jpg"), png());
    await expect(
      importLocalAsset(article, "images/fake.jpg", {
        importedBy: "human:test",
      }),
    ).rejects.toMatchObject({ code: "MIME_EXTENSION_MISMATCH" });
    await writeFile(
      path.join(article, "images", "broken.png"),
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    await expect(
      importLocalAsset(article, "images/broken.png", {
        importedBy: "human:test",
      }),
    ).rejects.toMatchObject({ code: "CORRUPT_IMAGE" });
    await writeFile(path.join(article, "images", "bomb.png"), png(9000, 9000));
    await expect(
      importLocalAsset(article, "images/bomb.png", {
        importedBy: "human:test",
      }),
    ).rejects.toMatchObject({ code: "IMAGE_BOMB" });

    const outside = await mkdtemp(path.join(path.dirname(article), "outside-"));
    roots.push(outside);
    await writeFile(path.join(outside, "secret.png"), png());
    try {
      await symlink(
        outside,
        path.join(article, "images", "linked"),
        "junction",
      );
      await expect(
        importLocalAsset(article, "images/linked/secret.png", {
          importedBy: "human:test",
        }),
      ).rejects.toMatchObject({ code: "PATH_TRAVERSAL" });
    } catch (error) {
      if (
        !(
          error instanceof Error &&
          "code" in error &&
          (error as NodeJS.ErrnoException).code === "EPERM"
        )
      )
        throw error;
    }

    const externalAssets = await mkdtemp(
      path.join(path.dirname(article), "external-assets-"),
    );
    roots.push(externalAssets);
    try {
      await symlink(externalAssets, path.join(article, "assets"), "junction");
      await writeFile(path.join(article, "images", "valid.png"), png());
      await expect(
        importLocalAsset(article, "images/valid.png", {
          importedBy: "human:test",
        }),
      ).rejects.toMatchObject({ code: "SYMLINK_ESCAPE" });
      await expect(
        stat(path.join(externalAssets, "originals")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } catch (error) {
      if (
        !(
          error instanceof Error &&
          "code" in error &&
          (error as NodeJS.ErrnoException).code === "EPERM"
        )
      )
        throw error;
    }
  });

  it("detects EXIF and GPS and never overwrites an original during derived cleanup", async () => {
    const article = await makeArticle();
    const original = jpegWithGps();
    await writeFile(path.join(article, "images", "photo.jpg"), original);
    const imported = await importLocalAsset(article, "images/photo.jpg", {
      importedBy: "human:test",
      sourceType: "user_owned",
      userOwnedConfirmed: true,
    });
    expect(imported.asset.exif_present).toBe(true);
    expect(imported.asset.gps_metadata_present).toBe(true);
    const cleaned = png();
    const processor: DerivedImageProcessor = {
      process: async () => ({ data: cleaned, contentType: "image/png" }),
    };
    const optimized = await optimizeArticleAssets(article, {
      processor,
      forceReencode: true,
    });
    expect(optimized.optimized).toBe(1);
    expect(
      await readFile(
        path.join(article, ...imported.asset.normalized_path.split("/")),
      ),
    ).toEqual(original);
    const output = optimized.manifest.assets[0].build_outputs[0];
    expect(output.path).toMatch(/^build\/assets\/[a-f0-9]{64}\.png$/);
    expect(
      await readFile(path.join(article, ...output.path.split("/"))),
    ).toEqual(cleaned);
    expect(optimized.manifest.assets[0].transformations[0]).toMatchObject({
      type: "privacy_cleanup",
      privacy_metadata_removed: true,
    });
  });
});

describe("discovery and SVG safety", () => {
  it("discovers Markdown/reference/HTML images while ignoring fenced examples", () => {
    const references = scanMarkdownImageReferences(
      '![one](images/a.png)\n![two][b]\n[b]: https://cdn.example/image.png\n<img src="images/c.png" alt="three">\n```\n![ignored](https://bad.example/x.png)\n```',
    );
    expect(references.map((item) => [item.kind, item.source])).toEqual([
      ["markdown", "images/a.png"],
      ["reference", "https://cdn.example/image.png"],
      ["html", "images/c.png"],
    ]);
  });

  it("scan reports unregistered and remote references without invoking network", async () => {
    const article = await makeArticle(
      "![local](images/a.png)\n![remote](https://cdn.example/image.png)\n",
    );
    await writeFile(path.join(article, "images", "a.png"), png());
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await scanArticleAssets(article);
    expect(result.networkRequests).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "LOCAL_IMAGE_NOT_REGISTERED",
        "REMOTE_IMAGE_NOT_IMPORTED",
      ]),
    );
    expect(await readAssetManifest(article)).toMatchObject({
      schema_version: "1",
      assets: [],
    });
  });

  it("rejects SVG script, handlers, external links, data resources, imports, and entities", () => {
    const unsafe = [
      "<svg width='1' height='1'><script/></svg>",
      "<svg width='1' height='1' onload='x()'/>",
      "<svg width='1' height='1'><image href='https://evil.test/x'/></svg>",
      "<svg width='1' height='1'><style>x{fill:url(data:x)}</style></svg>",
      "<svg width='1' height='1'><style>@import 'x'</style></svg>",
      "<!DOCTYPE svg [<!ENTITY x SYSTEM 'file:///etc/passwd'>]><svg width='1' height='1'/>",
    ];
    for (const source of unsafe) {
      expect(() =>
        inspectImageBytes(Buffer.from(source), { fileName: "x.svg" }),
      ).toThrow();
    }
  });
});

describe("SSRF-safe explicit remote import", () => {
  it.each([
    "file:///tmp/x.png",
    "ftp://example.com/x.png",
    "http://localhost/x.png",
    "http://127.0.0.1/x.png",
    "http://10.0.0.1/x.png",
    "http://172.16.0.1/x.png",
    "http://192.168.1.1/x.png",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/x.png",
    "http://[0:0:0:0:0:0:0:1]/x.png",
    "http://[::ffff:127.0.0.1]/x.png",
  ])("blocks %s", async (url) => {
    await expect(
      assertSafeRemoteImageUrl(url, { resolveDns: false }),
    ).rejects.toMatchObject({
      code: expect.stringMatching(/INVALID_NETWORK_URL|SSRF_BLOCKED/),
    });
  });

  it("blocks any private DNS answer and a private redirect target", async () => {
    await expect(
      assertSafeRemoteImageUrl("https://images.example/x.png", {
        resolver: async () => ["93.184.216.34", "10.0.0.2"],
      }),
    ).rejects.toMatchObject({ code: "SSRF_BLOCKED" });
    const fetcher: SecureRemoteFetcher = {
      fetch: async () => ({
        data: png(),
        contentType: "image/png",
        finalUrl: "http://169.254.169.254/secret",
        redirectChain: ["http://169.254.169.254/secret"],
      }),
    };
    await expect(
      securelyFetchRemoteImage("https://images.example/x.png", fetcher, {
        resolver: async () => ["93.184.216.34"],
      }),
    ).rejects.toMatchObject({ code: "SSRF_BLOCKED" });
  });

  it("enforces redirect and byte limits and records remote imports as pending", async () => {
    const resolver = async () => ["93.184.216.34"];
    const tooMany: SecureRemoteFetcher = {
      fetch: async () => ({
        data: png(),
        redirectChain: [
          "https://a.example/1",
          "https://a.example/2",
          "https://a.example/3",
          "https://a.example/4",
        ],
      }),
    };
    await expect(
      securelyFetchRemoteImage("https://images.example/x.png", tooMany, {
        resolver,
        maxRedirects: 3,
      }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REDIRECTS" });
    const tooLarge: SecureRemoteFetcher = {
      fetch: async () => ({ data: png(), contentLength: 999 }),
    };
    await expect(
      securelyFetchRemoteImage("https://images.example/x.png", tooLarge, {
        resolver,
        maxBytes: 100,
      }),
    ).rejects.toMatchObject({ code: "MEDIA_TOO_LARGE" });

    const article = await makeArticle();
    const imported = await importRemoteAsset(
      article,
      "https://images.example/photo.png",
      {
        importedBy: "human:test",
        rightsAcknowledged: true,
        fetcher: {
          fetch: async () => ({
            data: png(),
            contentType: "image/png",
            finalUrl: "https://images.example/photo.png",
          }),
        },
        fetchPolicy: { resolver },
      },
    );
    expect(imported.asset).toMatchObject({
      source_type: "remote",
      source_url: "https://images.example/photo.png",
      rights_status: "pending",
    });
    expect(verifyAssetRights(imported.manifest).publishReady).toBe(false);
  });

  it("times out even when an injected fetcher ignores AbortSignal", async () => {
    const never: SecureRemoteFetcher = {
      fetch: async () => new Promise(() => undefined),
    };
    await expect(
      securelyFetchRemoteImage("https://images.example/x.png", never, {
        resolver: async () => ["93.184.216.34"],
        timeoutMs: 5,
      }),
    ).rejects.toMatchObject({ code: "REMOTE_TIMEOUT" });
  });
});

describe("manifest and rights hardening", () => {
  it("requires explicit human confirmation before rights become approved", async () => {
    const article = await makeArticle();
    await writeFile(path.join(article, "images", "owned.png"), png());
    const imported = await importLocalAsset(article, "images/owned.png", {
      importedBy: "human:test",
      sourceType: "user_owned",
      userOwnedConfirmed: true,
    });
    await expect(
      updateAssetRights(article, imported.asset.asset_id, {
        rightsStatus: "approved",
      }),
    ).rejects.toMatchObject({ code: "HUMAN_RIGHTS_CONFIRMATION_REQUIRED" });
    const result = await updateAssetRights(article, imported.asset.asset_id, {
      rightsStatus: "approved",
      confirmedByHuman: true,
      userOwnedConfirmed: true,
      creator: "Fixture author",
      license: "user-owned",
    });
    expect(result.verification.publishReady).toBe(true);
  });

  it("rejects path injection and attribution omissions", async () => {
    const article = await makeArticle();
    await writeFile(path.join(article, "images", "one.png"), png());
    const imported = await importLocalAsset(article, "images/one.png", {
      importedBy: "human:test",
      creator: "Fixture author",
      license: "CC-BY-4.0",
      rightsStatus: "approved",
      rightsConfirmedByHuman: true,
    });
    expect(verifyAssetRights(imported.manifest).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "ATTRIBUTION_REQUIRED",
          blocking: true,
        }),
      ]),
    );
    const injected = structuredClone(imported.manifest) as AssetManifest;
    injected.assets[0].normalized_path = "assets/originals/../../escape.png";
    expect(() => validateAssetManifest(injected)).toThrow(
      "outside assets/originals/",
    );
  });
});
