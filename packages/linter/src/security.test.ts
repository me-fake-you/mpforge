import { describe, expect, it } from "vitest";
import { inspectHtmlStages, lintArticle } from "./index.js";
import { validArticle } from "./__fixtures__/articles.js";

describe("deterministic security rules", () => {
  it("blocks unsafe HTML, event handlers, URLs, SVG, and CSS expressions", () => {
    const raw = [
      '<script src="https://evil.test/x.js"></script>',
      '<iframe src="https://evil.test"></iframe>',
      '<a href="javascript:alert(1)" onclick="go()">x</a>',
      '<img src="data:image/png;base64,AAAA">',
      '<svg><image href="https://evil.test/a.png"></image></svg>',
    ].join("");
    const report = inspectHtmlStages({
      file: "content/unsafe/article.md",
      rawHtml: raw,
      css: "a{width:900px;position:fixed;behavior:url(x);width:expression(1);background:url(https://evil.test/a)}",
    });
    const ids = report.diagnostics.map((d) => d.rule_id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "html.raw.tag.script",
        "html.raw.tag.iframe",
        "html.raw.event-handler",
        "html.raw.javascript-url",
        "html.raw.data-url",
        "html.raw.unsafe-svg",
        "css.raw.expression",
        "css.raw.behavior",
        "css.raw.position-fixed",
        "css.raw.remote-background",
        "css.raw.fixed-width-overflow",
      ]),
    );
  });

  it("detects significant content loss between safe and WeChat simulation", () => {
    const safe = `<p>${"reviewed text ".repeat(20)}</p>`;
    const report = inspectHtmlStages({
      file: "article.md",
      rawHtml: safe,
      safeHtml: safe,
      wechatHtml: "<p>short</p>",
    });
    expect(
      report.wechat.some(
        (d) => d.rule_id === "wechat.content-loss" && d.severity === "ERROR",
      ),
    ).toBe(true);
  });

  it("blocks dummy secret patterns without containing a real credential fixture", () => {
    const dummy = `api_key=${"Z".repeat(32)}`;
    const report = lintArticle(
      validArticle({ markdown: `# Secret\n\n${dummy}` }),
    );
    expect(
      report.diagnostics.some(
        (d) => d.rule_id === "secret.possible" && d.severity === "ERROR",
      ),
    ).toBe(true);
  });

  it("blocks unsafe or unlicensed asset metadata", () => {
    const input = validArticle();
    input.assets = [
      {
        reference: "assets/cover.png",
        exists: true,
        unsafeSvg: true,
        sourceType: "remote",
        sourceUrl: null,
        rightsStatus: "blocked",
        requiresAttribution: true,
        attribution: null,
      },
    ];
    const ids = lintArticle(input).diagnostics.map((d) => d.rule_id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "image.svg.unsafe",
        "asset.rights.blocked",
        "asset.remote.source-url.missing",
        "asset.attribution.missing",
      ]),
    );
  });

  it("never fetches remote images during lint", () => {
    let calls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      calls += 1;
      throw new Error("network forbidden");
    }) as typeof fetch;
    try {
      lintArticle(
        validArticle({
          markdown: "# Remote\n\n![remote](https://example.test/image.png)",
        }),
      );
      expect(calls).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
