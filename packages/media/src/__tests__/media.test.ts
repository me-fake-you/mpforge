import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  importNetworkImages,
  inspectSvgSafety,
  resolveProjectChromiumExecutable,
  resolveLocalImageReference,
  stageLocalImages,
  uploadStagedImages,
  type ImageTransformer,
} from "../index.js";

const roots: string[] = [];

async function makeArticle(): Promise<string> {
  const testRoot = path.resolve(process.cwd(), "tmp", "media-tests");
  await mkdir(testRoot, { recursive: true });
  const root = await mkdtemp(path.join(testRoot, "article-"));
  roots.push(root);
  await mkdir(path.join(root, "images"));
  return root;
}

function png(width = 1, height = 1): Buffer {
  const result = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(result);
  result.writeUInt32BE(width, 16);
  result.writeUInt32BE(height, 20);
  return result;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("local image resolution and staging", () => {
  it("rejects missing files and all traversal forms, including Windows paths", async () => {
    const article = await makeArticle();
    await expect(
      resolveLocalImageReference(article, "images/missing.png"),
    ).rejects.toMatchObject({ code: "MEDIA_FILE_MISSING" });
    await expect(
      resolveLocalImageReference(article, "../outside.png"),
    ).rejects.toMatchObject({ code: "PATH_TRAVERSAL" });
    await expect(
      resolveLocalImageReference(article, "..\\outside.png"),
    ).rejects.toMatchObject({ code: "PATH_TRAVERSAL" });
    await expect(
      resolveLocalImageReference(article, "C:\\outside.png"),
    ).rejects.toMatchObject({ code: "PATH_TRAVERSAL" });
    await expect(
      resolveLocalImageReference(article, "https://example.test/image.png"),
    ).rejects.toMatchObject({ code: "NETWORK_REFERENCE" });
  });

  it("uses SHA-256 content addressing and deduplicates identical bytes", async () => {
    const article = await makeArticle();
    const bytes = png();
    await writeFile(path.join(article, "images", "first.png"), bytes);
    await writeFile(path.join(article, "images", "second.png"), bytes);
    const result = await stageLocalImages(article, [
      "images/first.png",
      "images/second.png",
    ]);
    const hash = createHash("sha256").update(bytes).digest("hex");
    expect(result.images).toHaveLength(2);
    expect(result.images[0].contentHash).toBe(hash);
    expect(result.images[0].relativePath).toBe(`assets/${hash}.png`);
    expect(result.images[1].relativePath).toBe(result.images[0].relativePath);
    expect(await readdir(path.join(article, "assets"))).toEqual([
      `${hash}.png`,
    ]);
    expect(result.replacements["images/second.png"]).toBe(`assets/${hash}.png`);
  });

  it("enforces byte and dimension limits", async () => {
    const article = await makeArticle();
    await writeFile(path.join(article, "images", "large.png"), png(20, 1));
    await expect(
      stageLocalImages(article, ["images/large.png"], { maxWidth: 10 }),
    ).rejects.toMatchObject({ code: "MEDIA_TOO_WIDE" });
    await expect(
      stageLocalImages(article, ["images/large.png"], { maxBytes: 10 }),
    ).rejects.toMatchObject({ code: "MEDIA_TOO_LARGE" });
  });
});

describe("SVG and explicit network imports", () => {
  it("rejects active, external, and executable SVG content", () => {
    expect(
      inspectSvgSafety(Buffer.from("<svg><script>alert(1)</script></svg>"))
        .safe,
    ).toBe(false);
    expect(
      inspectSvgSafety(
        Buffer.from('<svg><image href="https://evil.test/a.png" /></svg>'),
      ).safe,
    ).toBe(false);
    expect(
      inspectSvgSafety(Buffer.from('<svg onload="alert(1)"></svg>')).safe,
    ).toBe(false);
    expect(
      inspectSvgSafety(Buffer.from('<svg><rect width="1" height="1" /></svg>'))
        .safe,
    ).toBe(true);
    expect(
      inspectSvgSafety(
        Buffer.from(
          '<svg><style>@import "https://evil.test/a.css"</style></svg>',
        ),
      ).safe,
    ).toBe(false);
  });

  it.skipIf(!resolveProjectChromiumExecutable())(
    "rasterizes safe SVG through project-local Chromium",
    async () => {
      const article = await makeArticle();
      await writeFile(
        path.join(article, "images", "safe.svg"),
        '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"><rect width="64" height="32" fill="#2563eb" /></svg>',
      );
      const result = await stageLocalImages(article, ["images/safe.svg"]);
      const image = result.images[0];
      expect(image.mimeType).toBe("image/png");
      expect(image.relativePath).toMatch(/^assets\/[a-f0-9]{64}\.png$/);
      expect(image.dimensions).toEqual({ width: 64, height: 32 });
      expect((await readFile(image.absolutePath)).subarray(0, 8)).toEqual(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      );
    },
  );

  it("requires explicit rights-confirmed network import and maps its URL", async () => {
    const article = await makeArticle();
    const fetcher = {
      fetch: async ({ url }: { url: string }) => {
        expect(url).toBe("https://cdn.example.test/image.png");
        return { data: png(), contentType: "image/png" };
      },
    };
    await expect(
      importNetworkImages(
        article,
        [
          {
            url: "https://cdn.example.test/image.png",
            rightsConfirmed: false as true,
          },
        ],
        fetcher,
      ),
    ).rejects.toMatchObject({ code: "RIGHTS_UNCONFIRMED" });
    const result = await importNetworkImages(
      article,
      [{ url: "https://cdn.example.test/image.png", rightsConfirmed: true }],
      fetcher,
    );
    expect(result.replacements["https://cdn.example.test/image.png"]).toMatch(
      /^assets\/[a-f0-9]{64}\.png$/,
    );
  });
});

describe("transactional staging and confirmed upload", () => {
  it("rolls back staged files if transformation fails", async () => {
    const article = await makeArticle();
    await writeFile(path.join(article, "images", "one.png"), png());
    await writeFile(path.join(article, "images", "two.png"), png(2, 2));
    let calls = 0;
    const transformer: ImageTransformer = {
      transform(data, mimeType) {
        calls += 1;
        if (calls === 2) throw new Error("simulated conversion failure");
        return { source: "transformed", data, contentType: mimeType };
      },
    };
    await expect(
      stageLocalImages(article, ["images/one.png", "images/two.png"], {
        transformer,
      }),
    ).rejects.toThrow("simulated conversion failure");
    await expect(readdir(path.join(article, "assets"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("does not upload until explicitly confirmed and rolls back prior uploads on failure", async () => {
    const article = await makeArticle();
    await writeFile(path.join(article, "images", "one.png"), png());
    await writeFile(path.join(article, "images", "two.png"), png(2, 2));
    const stage = await stageLocalImages(article, [
      "images/one.png",
      "images/two.png",
    ]);
    const rollback: string[] = [];
    let uploadCalls = 0;
    const uploader = {
      upload: async ({ contentHash }: { contentHash: string }) => {
        uploadCalls += 1;
        if (uploadCalls === 2) throw new Error("simulated upload failure");
        return { url: `https://media.example.test/${contentHash}` };
      },
      rollback: async ({ url }: { url: string }) => {
        rollback.push(url);
      },
    };
    await expect(
      uploadStagedImages(stage, uploader, {
        confirmed: false as true,
        accountAlias: "",
      }),
    ).rejects.toMatchObject({ code: "UPLOAD_NOT_CONFIRMED" });
    expect(uploadCalls).toBe(0);
    await expect(
      uploadStagedImages(stage, uploader, {
        confirmed: true,
        accountAlias: "test-account",
      }),
    ).rejects.toThrow("simulated upload failure");
    expect(rollback).toHaveLength(1);
    expect(rollback[0]).toMatch(
      /^https:\/\/media\.example\.test\/[a-f0-9]{64}$/,
    );
    await expect(readFile(stage.images[0].absolutePath)).resolves.toEqual(
      png(),
    );
  });

  it("rejects an uploader result that is not a URL", async () => {
    const article = await makeArticle();
    await writeFile(path.join(article, "images", "one.png"), png());
    const stage = await stageLocalImages(article, ["images/one.png"]);
    const uploader = { upload: async () => ({ url: "not-a-url" }) };
    await expect(
      uploadStagedImages(stage, uploader, {
        confirmed: true,
        accountAlias: "test-account",
      }),
    ).rejects.toMatchObject({ code: "INVALID_UPLOAD_RESULT" });
  });
});
