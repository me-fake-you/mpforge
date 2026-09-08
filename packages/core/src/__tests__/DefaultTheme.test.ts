import { describe, expect, it } from "vitest";
import { customDefaultTheme } from "../themes";

describe("default theme", () => {
  it("使用翡翠强调色并覆盖主要文章元素", () => {
    for (const selector of [
      "#wemd h1",
      "#wemd h2",
      "#wemd h3",
      "#wemd .multiquote-1",
      "#wemd ul",
      "#wemd ol",
      "#wemd figcaption",
      "#wemd pre code.hljs",
      "#wemd table",
      "#wemd .callout",
      "#wemd .footnotes-sep",
      "#wemd .block-equation > svg",
    ]) {
      expect(customDefaultTheme, `缺少 ${selector}`).toContain(selector);
    }

    expect(customDefaultTheme).toContain("#047857");
  });

  it("显式移除基础主题中链接图片说明的黑底悬浮样式", () => {
    expect(customDefaultTheme).toMatch(
      /#wemd figure a \+ figcaption\s*\{[\s\S]*?margin-top:\s*10px;[\s\S]*?background:\s*transparent;[\s\S]*?color:\s*#606b64;/,
    );
  });

  it("默认主题声明保持扁平并避免低对比度弱文字", () => {
    expect(customDefaultTheme).not.toMatch(/linear-gradient|radial-gradient/i);
    expect(customDefaultTheme).not.toContain("#8a9791");
    expect(customDefaultTheme).not.toMatch(/opacity:\s*0\.[0-9]+/);
  });
});
