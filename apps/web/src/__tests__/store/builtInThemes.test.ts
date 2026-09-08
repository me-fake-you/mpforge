import { describe, expect, it } from "vitest";
import { modernEditorialTheme } from "@wemd/core";
import { originalThemes } from "@mpforge/themes";
import { builtInThemes } from "../../store/themes/builtInThemes";
import { useThemeStore } from "../../store/themeStore";

describe("built-in themes", () => {
  it("注册编辑部手记主题并组合基础与代码样式", () => {
    const theme = builtInThemes.find((item) => item.id === "modern-editorial");

    expect(theme).toBeTruthy();
    expect(theme?.name).toBe("编辑部手记");
    expect(theme?.isBuiltIn).toBe(true);
    expect(theme?.css).toContain(modernEditorialTheme);
    expect(theme?.css).toContain("#wemd .hljs");
  });

  it("下架旧主题但保留注册信息供历史文章恢复", () => {
    const retiredThemeIds = [
      "template",
      "aurora-glass",
      "cyberpunk-neon",
      "bauhaus",
      "neo-brutalism",
    ];

    for (const themeId of retiredThemeIds) {
      const theme = builtInThemes.find((item) => item.id === themeId);
      expect(theme, `${themeId} 应继续保留注册信息`).toBeTruthy();
      expect(theme?.isSelectable).toBe(false);
      expect(theme?.css).toContain("#wemd");
    }

    expect(
      builtInThemes.find((item) => item.id === "luxury-gold")?.isSelectable,
    ).toBe(false);
  });

  it("仍可按主题 ID 恢复下架主题", () => {
    const state = useThemeStore.getState();

    state.selectTheme("bauhaus");

    expect(useThemeStore.getState().themeId).toBe("bauhaus");
    expect(useThemeStore.getState().getThemeCSS("bauhaus")).toContain(
      "包豪斯风格",
    );

    useThemeStore.getState().selectTheme("default");
  });

  it("v0.1 只公开四款原创 MPForge 主题", () => {
    const selectable = builtInThemes.filter(
      (theme) => theme.isSelectable !== false,
    );
    expect(selectable.map((theme) => theme.id)).toEqual([
      "minimal",
      "academic-blue",
      "warm-editorial",
      "tech-dark-accent",
    ]);

    for (const expected of originalThemes) {
      const { id, name, lightCss } = expected;
      const theme = builtInThemes.find((item) => item.id === id);
      expect(theme).toBeTruthy();
      expect(theme?.name).toBe(name);
      expect(theme?.isSelectable).not.toBe(false);
      expect(theme?.css).toBe(lightCss);
    }
  });

  it("深色代码块主题使用可读的深色语法高亮配色", () => {
    const darkCodeThemeIds = [
      "modern-editorial",
      "data-blueprint",
      "eastern-notes",
      "clear-guide",
      "whitespace-gallery",
    ];

    for (const themeId of darkCodeThemeIds) {
      const theme = builtInThemes.find((item) => item.id === themeId);

      expect(theme?.css, themeId).toMatch(
        /#wemd \.hljs-attr,[\s\S]*?#wemd \.hljs-literal,[\s\S]*?color:\s*#79c0ff;/,
      );
      expect(theme?.css, themeId).not.toMatch(
        /#wemd \.hljs-number,[\s\S]*?#wemd \.hljs-literal,[\s\S]*?color:\s*#008080;/,
      );
    }
  });
});
