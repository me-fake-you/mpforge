import { processHtml } from "@wemd/core";
import { describe, expect, it } from "vitest";
import { resolveInlineStyleVariablesForCopy } from "../../services/inlineStyleVarResolver";
import { normalizeCopyContainer } from "../../services/wechatCopyNormalizer";

describe("wechat background canvas integration", () => {
  it("keeps a Juice-inlined multi-layer background on one root section", () => {
    const html = `
      <h1><span class="content">标题</span></h1>
      <p data-source="kept">正文 <strong>加粗</strong> <a href="https://example.com">链接</a></p>
      <blockquote><p>引用</p></blockquote>
      <ul><li><section>列表</section></li></ul>
      <pre><code>const answer = 42;</code></pre>
      <table><tbody><tr><td>单元格</td></tr></tbody></table>
    `;
    const css = `
      #wemd {
        padding: 24px 18px;
        color: #1f2937;
        background-color: #fffaf0;
        background-image:
          linear-gradient(90deg, rgba(217, 119, 6, 0.28) 1px, transparent 1px),
          linear-gradient(0deg, rgba(220, 38, 38, 0.2) 1px, transparent 1px);
        background-position: center center;
        background-size: 20px 20px;
        background-repeat: repeat;
      }
      #wemd h1 { border-bottom: 3px solid #dc2626; }
      #wemd blockquote { border-left: 5px solid #dc2626; }
      #wemd pre { color: #f8fafc; background-color: #1f2937; }
      #wemd table { border-collapse: collapse; }
      #wemd td { border: 1px solid #d97706; }
    `;
    const styledHtml = resolveInlineStyleVariablesForCopy(
      processHtml(html, css, true, true),
    );
    const container = document.createElement("div");
    container.innerHTML = styledHtml;
    const sourceRoot = container.firstElementChild as HTMLElement;
    const sourceChildren = Array.from(sourceRoot.children);

    expect(sourceRoot.tagName).toBe("SECTION");
    expect(sourceRoot.id).toBe("wemd");
    expect(
      sourceRoot.style.backgroundImage.match(/linear-gradient/g),
    ).toHaveLength(2);

    normalizeCopyContainer(container);

    const root = container.firstElementChild as HTMLElement;
    expect(container.childElementCount).toBe(1);
    expect(root).toBe(sourceRoot);
    expect(root.tagName).toBe("SECTION");
    expect(root.id).toBe("");
    expect(Array.from(root.children)).toEqual(sourceChildren);
    expect(root.style.paddingTop).toBe("24px");
    expect(root.style.paddingRight).toBe("18px");
    expect(root.style.paddingBottom).toBe("24px");
    expect(root.style.paddingLeft).toBe("18px");
    expect(root.style.backgroundColor).toBe("rgb(255, 250, 240)");
    expect(root.style.backgroundImage.match(/linear-gradient/g)).toHaveLength(
      2,
    );
    expect(root.style.backgroundPosition).toBe("center center");
    expect(root.style.backgroundSize).toBe("20px 20px");
    expect(root.style.backgroundRepeat).toBe("repeat");
    expect(root.querySelector("p[data-source='kept']")?.parentElement).toBe(
      root,
    );
    expect(root.querySelector("a")?.getAttribute("href")).toBe(
      "https://example.com",
    );
    expect(root.querySelector("pre code")?.textContent).toBe(
      "const answer = 42;",
    );
    expect(root.querySelector("table td")?.textContent).toBe("单元格");
  });
});
