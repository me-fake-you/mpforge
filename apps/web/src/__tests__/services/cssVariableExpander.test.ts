import { describe, expect, it } from "vitest";
import { expandCSSVariables } from "../../services/cssVariableExpander";

describe("expandCSSVariables", () => {
  it("expands simple var() references", () => {
    const css = `
      #wemd { --wemd-font-size: 14px; --wemd-text-color: #333; }
      #wemd p { font-size: var(--wemd-font-size); color: var(--wemd-text-color); }
    `;
    const result = expandCSSVariables(css);

    expect(result).toContain("font-size: 14px");
    expect(result).toContain("color: #333");
    expect(result).not.toContain("var(--wemd-font-size)");
    expect(result).not.toContain("var(--wemd-text-color)");
  });

  it("removes custom property declarations", () => {
    const css = `
      #wemd { --wemd-font-size: 14px; font-family: serif; }
      #wemd p { font-size: var(--wemd-font-size); }
    `;
    const result = expandCSSVariables(css);

    expect(result).not.toMatch(/--wemd-font-size\s*:/);
    expect(result).toContain("font-family: serif");
    expect(result).toContain("font-size: 14px");
  });

  it("removes custom properties that follow comments in the same rule block", () => {
    const css = `
      #wemd {
        /* 页面布局 */
        --wemd-page-padding: 20px;
        /* 背景 */
        --wemd-grid-color: rgba(50, 0, 0, 0.05);
        padding: 30px var(--wemd-page-padding);
        background-image: linear-gradient(90deg, var(--wemd-grid-color) 1px, transparent 1px);
      }
    `;
    const result = expandCSSVariables(css);

    expect(result).toContain("padding: 30px 20px");
    expect(result).toContain("rgba(50, 0, 0, 0.05) 1px");
    expect(result).not.toMatch(/--[\w-]+\s*:/);
  });

  it("ignores semicolons inside comments when removing custom properties", () => {
    const css = `
      #wemd {
        /* 页面布局；英文分隔符也允许 ; spacing */
        --wemd-page-padding: 20px;
        padding: 30px var(--wemd-page-padding);
      }
    `;
    const result = expandCSSVariables(css);

    expect(result).toContain("padding: 30px 20px");
    expect(result).not.toMatch(/--[\w-]+\s*:/);
  });

  it("preserves semicolons inside quoted custom property values", () => {
    const css = `
      #wemd {
        --wemd-data-label: "grid;paper";
      }
      #wemd::before {
        content: var(--wemd-data-label);
      }
    `;
    const result = expandCSSVariables(css);

    expect(result).toContain('content: "grid;paper"');
    expect(result).not.toMatch(/--[\w-]+\s*:/);
  });

  it("removes empty rule blocks after stripping declarations", () => {
    const css = `
      #wemd { --wemd-font-size: 14px; }
      #wemd p { font-size: var(--wemd-font-size); }
    `;
    const result = expandCSSVariables(css);

    // 只含变量声明的规则块应被移除
    expect(result).not.toMatch(/#wemd\s*\{\s*\}/);
    expect(result).toContain("font-size: 14px");
  });

  it("handles var() with fallback", () => {
    const css = `
      #wemd p { color: var(--undefined-var, #999); }
    `;
    const result = expandCSSVariables(css);

    expect(result).toContain("color: #999");
    expect(result).not.toContain("var(");
  });

  it("resolves chained variable references", () => {
    const css = `
      #wemd { --a: 16px; --b: var(--a); }
      #wemd p { font-size: var(--b); }
    `;
    const result = expandCSSVariables(css);

    expect(result).toContain("font-size: 16px");
    expect(result).not.toContain("var(");
  });

  it("falls back on circular variable references", () => {
    const css = `
      #wemd { --a: var(--b); --b: var(--a); }
      #wemd p { color: var(--a, #fallback); }
    `;
    const result = expandCSSVariables(css);

    expect(result).toContain("color: #fallback");
    expect(result).not.toContain("var(--a");
    expect(result).not.toContain("var(--b");
  });

  it("returns css unchanged when no var() present", () => {
    const css = "#wemd p { font-size: 14px; color: #333; }";
    expect(expandCSSVariables(css)).toBe(css);
  });

  it("returns empty string for empty input", () => {
    expect(expandCSSVariables("")).toBe("");
  });

  it("handles rgba and complex values", () => {
    const css = `
      #wemd { --wemd-primary: #1677ff; --wemd-primary-20: rgba(22, 119, 255, 0.12); }
      #wemd strong { background: var(--wemd-primary-20); color: var(--wemd-primary); }
    `;
    const result = expandCSSVariables(css);

    expect(result).toContain("background: rgba(22, 119, 255, 0.12)");
    expect(result).toContain("color: #1677ff");
    expect(result).not.toContain("var(");
  });

  it("handles nested var() in fallback", () => {
    const css = `
      #wemd { --wemd-primary: blue; }
      #wemd a { color: var(--missing, var(--wemd-primary)); }
    `;
    const result = expandCSSVariables(css);

    expect(result).toContain("color: blue");
    expect(result).not.toContain("var(");
  });

  it("preserves non-variable properties in mixed rule blocks", () => {
    const css = `
      #wemd { --wemd-font-size: 14px; padding: 0 8px; color: #333; overflow-wrap: break-word; }
    `;
    const result = expandCSSVariables(css);

    expect(result).toContain("padding: 0 8px");
    expect(result).toContain("color: #333");
    expect(result).toContain("overflow-wrap: break-word");
    expect(result).not.toMatch(/--wemd-font-size\s*:/);
  });

  it("ignores braces inside comments when parsing rule blocks", () => {
    const css = `
      #wemd {
        /* group { vars } */
        --grid-color: red;
        background: var(--grid-color);
      }
    `;
    const result = expandCSSVariables(css);

    expect(result).toContain("background: red");
    expect(result).not.toContain("var(");
    expect(result).not.toMatch(/--grid-color\s*:/);
  });

  it("ignores braces inside strings when parsing rule blocks", () => {
    const css = `
      #wemd { --label: "grid;paper"; }
      #wemd::before { content: "{"; }
      #wemd::after { content: "}"; }
    `;
    const result = expandCSSVariables(css);

    expect(result).toContain('content: "{"');
    expect(result).toContain('content: "}"');
    expect(result).not.toMatch(/--label\s*:/);
  });

  it("keeps rule blocks intact when braces appear in data URIs", () => {
    const css = `
      .wemd-icon {
        background: url("data:image/svg+xml;utf8,<svg>{}</svg>");
        --wemd-icon-size: 2px;
        padding: var(--wemd-icon-size);
      }
    `;
    const result = expandCSSVariables(css);

    expect(result).toContain('url("data:image/svg+xml;utf8,<svg>{}</svg>")');
    expect(result).toContain("padding: 2px");
    expect(result).not.toMatch(/--wemd-icon-size\s*:/);
  });
});
