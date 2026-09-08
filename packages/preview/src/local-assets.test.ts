import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { preparePreviewStages } from "./local-assets.js";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

describe("preparePreviewStages", () => {
  it("inlines bounded local images and reports traversal and unsafe SVG without reading them", async () => {
    const root = path.resolve(
      process.cwd(),
      `.tmp-local-assets-${process.pid}-${Date.now()}`,
    );
    const article = path.join(root, "article");
    await mkdir(path.join(article, "assets"), { recursive: true });
    await writeFile(path.join(article, "assets", "pixel.png"), PNG_1X1);
    await writeFile(path.join(root, "outside.png"), PNG_1X1);
    await writeFile(
      path.join(article, "assets", "unsafe.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      "utf8",
    );
    try {
      const html = [
        '<img src="assets/pixel.png">',
        '<img src="../outside.png">',
        '<img src="assets/unsafe.svg">',
        '<img src="https://example.invalid/image.png">',
      ].join("");
      const result = await preparePreviewStages(
        { raw: html, safe: html, wechat: html },
        pathToFileURL(`${article}${path.sep}`).href,
      );
      expect(result.assets).toEqual([
        expect.objectContaining({
          original_reference: "assets/pixel.png",
          local_path: "assets/pixel.png",
          mime_type: "image/png",
          byte_length: PNG_1X1.byteLength,
        }),
      ]);
      expect(result.stages.raw).toContain("data:image/png;base64,");
      expect(result.stages.raw).not.toContain(path.join(root, "outside.png"));
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            original_reference: "../outside.png",
            code: "path-traversal",
          }),
          expect.objectContaining({
            original_reference: "assets/unsafe.svg",
            code: "unsafe-svg",
          }),
          expect.objectContaining({
            original_reference: "https://example.invalid/image.png",
            code: "network-blocked",
          }),
        ]),
      );
      expect(result.stages.raw.match(/data:,/g)).toHaveLength(3);
    } finally {
      if (
        !root.startsWith(`${path.resolve(process.cwd())}${path.sep}`) ||
        !path.basename(root).startsWith(".tmp-local-assets-")
      ) {
        throw new Error(`Refusing to clean unexpected test directory: ${root}`);
      }
      await rm(root, { recursive: true, force: true });
    }
  });
});
