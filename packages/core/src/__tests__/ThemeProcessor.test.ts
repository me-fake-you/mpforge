import { describe, expect, it, vi } from "vitest";
import http from "node:http";
import https from "node:https";
import { processHtml } from "../ThemeProcessor";

describe("ThemeProcessor CSS inlining", () => {
  it("inlines authored styles and pseudo elements without fetching remote resources", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const httpSpy = vi.spyOn(http, "request");
    const httpsSpy = vi.spyOn(https, "request");
    try {
      const output = processHtml(
        '<link rel="stylesheet" href="https://example.invalid/theme.css"><p class="intro">Hello</p><img src="https://example.invalid/image.png">',
        '@import url("https://example.invalid/extra.css"); #wemd .intro { color: red !important; } #wemd .intro::before { content: "Note: "; }',
        true,
        true,
      );

      expect(output).toMatch(/color:\s*red\s*!important/);
      expect(output).toContain("Note: ");
      expect(output).toContain('src="https://example.invalid/image.png"');
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(httpSpy).not.toHaveBeenCalled();
      expect(httpsSpy).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("preserves code indentation while applying copy-safe inline styles", () => {
    const output = processHtml(
      '<pre><code class="hljs">  first\n    second</code></pre>',
      "#wemd pre { background: #eee; } #wemd code { white-space: pre-wrap; }",
      true,
      true,
    );

    expect(output.replace(/\u00a0/g, "&nbsp;")).toContain(
      "&nbsp;&nbsp;first\n&nbsp;&nbsp;&nbsp;&nbsp;second",
    );
    expect(output).toContain("white-space:pre");
    expect(output).toContain("text-align:left");
    expect(output).toContain("overflow-x:auto");
  });
});

describe("ThemeProcessor mac bar", () => {
  it("保留 pre 与 code 之间的 Mac Bar 圆点，并保持代码空格保护", () => {
    const html =
      '<pre class="custom"><span class="mac-sign" style="display:block;padding:10px 14px 0;line-height:0;"><span class="mac-dot" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:rgb(237,108,96);"></span><span class="mac-dot" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:rgb(247,193,81);"></span><span class="mac-dot" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:rgb(100,200,86);"></span></span><code class="hljs language-ts">  const a = 1;\n    console.log(a);</code></pre>';
    const css = `
      #wemd pre.custom > .mac-sign {
        display: block;
      }
    `;

    const output = processHtml(html, css, false, true);

    expect(output.match(/class="mac-dot"/g)).toHaveLength(3);
    expect(output).not.toContain("<svg");
    expect(output).toMatch(
      /<pre[^>]*>\s*<span[^>]*>[\s\S]*class="mac-dot"[\s\S]*<\/span><code/i,
    );
    expect(output).not.toMatch(/<code[^>]*>[\s\S]*class="mac-dot"/i);
    expect(output).toContain("&nbsp;&nbsp;const a = 1;");
    expect(output).toContain("\n&nbsp;&nbsp;&nbsp;&nbsp;console.log(a);");
  });
});
