import { describe, expect, it } from "vitest";
import { originalThemes, SUPPORTED_THEME_ELEMENTS, themeCss } from "./index";

const requiredSelectors = [
  "#wemd",
  "#wemd p",
  "#wemd h1",
  "#wemd h2",
  "#wemd h3",
  "#wemd h4",
  "#wemd h5",
  "#wemd h6",
  "#wemd ul",
  "#wemd ol",
  "#wemd .task-list-item",
  "#wemd .multiquote-1",
  "#wemd table",
  "#wemd figure",
  "#wemd figcaption",
  "#wemd pre",
  "#wemd .callout",
  "#wemd .footnote-item",
  "#wemd .block-equation",
  "#wemd pre.mermaid",
];

describe("MPForge original themes", () => {
  it("exports exactly four stable IDs", () => {
    expect(originalThemes.map((theme) => theme.id)).toEqual([
      "minimal",
      "academic-blue",
      "warm-editorial",
      "tech-dark-accent",
    ]);
  });

  it("covers the article contract in both modes", () => {
    for (const theme of originalThemes) {
      for (const css of [theme.lightCss, theme.darkCss]) {
        for (const selector of requiredSelectors) {
          expect(css, `${theme.id} missing ${selector}`).toContain(selector);
        }
        expect(css).not.toContain("var(");
        expect(css).toMatch(/max-width:\s*100%/);
        expect(css).toMatch(/overflow(?:-x)?:\s*auto/);
      }
    }
  });

  it("keeps the four visual responsibilities distinct", () => {
    const [minimal, academic, warm, tech] = originalThemes;
    expect(minimal.lightCss).toContain("#3f6655");
    expect(academic.lightCss).toContain("#123a67");
    expect(warm.lightCss).toContain("#ad5d43");
    expect(tech.darkCss).toContain("#101629");
    expect(new Set(originalThemes.map((theme) => theme.lightCss)).size).toBe(4);
  });

  it("ships independent auditable metadata and original preview fixtures", () => {
    for (const theme of originalThemes) {
      expect(theme.description.length).toBeGreaterThan(30);
      expect(theme.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(theme.author).toBe("MPForge Contributors");
      expect(theme.license).toBe("MIT");
      expect(theme.primaryColor).toMatch(/^#[\da-f]{6}$/i);
      expect(theme.darkPrimaryColor).toMatch(/^#[\da-f]{6}$/i);
      expect(theme.supportedElements).toEqual(SUPPORTED_THEME_ELEMENTS);
      expect(theme.mobileFallbacks.length).toBeGreaterThanOrEqual(4);
      expect(theme.previewFixture).toContain("# ");
      expect(theme.previewFixture).toContain("| Signal | Result |");
      expect(theme.previewFixture).toContain("```ts");
    }
    expect(new Set(originalThemes.map((theme) => theme.description)).size).toBe(
      4,
    );
    expect(
      new Set(originalThemes.map((theme) => theme.previewFixture)).size,
    ).toBe(4);
  });

  it("allows a safe primary-colour variable and rejects CSS injection", () => {
    const academic = originalThemes[1];
    expect(themeCss(academic, "light", "#2468ac")).toContain("#2468ac");
    expect(themeCss(academic, "dark", "#2468ac")).toContain("#2468ac");
    expect(themeCss(academic, "light", "red;display:none")).toBe(
      academic.lightCss,
    );
    expect(academic.lightCss).toContain(academic.primaryColor);
  });

  it("keeps tech-dark-accent formal output light and confines dark emphasis", () => {
    const tech = originalThemes[3];
    expect(tech.lightCss).toContain("background:transparent");
    expect(tech.lightCss).toContain("#17213a");
    expect(tech.lightCss).not.toMatch(
      /#wemd\s*\{[^}]*background:#(?:0|1)[\da-f]{5}/i,
    );
  });
});
