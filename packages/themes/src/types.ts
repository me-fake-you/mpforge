export type ThemeMode = "light" | "dark";

export const SUPPORTED_THEME_ELEMENTS = [
  "heading",
  "paragraph",
  "blockquote",
  "unordered-list",
  "ordered-list",
  "task-list",
  "code-block",
  "inline-code",
  "table",
  "link",
  "image",
  "image-caption",
  "horizontal-rule",
  "callout",
  "footnote",
  "equation",
] as const;

export type SupportedThemeElement = (typeof SUPPORTED_THEME_ELEMENTS)[number];

export interface ThemeMetadata {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly author: string;
  readonly license: "MIT";
  readonly primaryColor: `#${string}`;
  readonly darkPrimaryColor: `#${string}`;
  readonly supportedElements: readonly SupportedThemeElement[];
  /** Explicit WeChat/mobile fallbacks that do not depend on media queries. */
  readonly mobileFallbacks: readonly string[];
  /** Original Markdown used by tests and the theme picker preview. */
  readonly previewFixture: string;
}

export interface ThemeDefinition extends ThemeMetadata {
  readonly lightCss: string;
  readonly darkCss: string;
}
