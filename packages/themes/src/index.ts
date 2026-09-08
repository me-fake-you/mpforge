export {
  SUPPORTED_THEME_ELEMENTS,
  type SupportedThemeElement,
  type ThemeDefinition,
  type ThemeMetadata,
  type ThemeMode,
} from "./types";
export { minimalTheme } from "./minimal";
export { academicBlueTheme } from "./academic-blue";
export { warmEditorialTheme } from "./warm-editorial";
export { techDarkAccentTheme } from "./tech-dark-accent";
export {
  minimalPreviewFixture,
  academicBluePreviewFixture,
  warmEditorialPreviewFixture,
  techDarkAccentPreviewFixture,
} from "./previewFixtures";

import type { ThemeDefinition, ThemeMode } from "./types";
import { academicBlueTheme } from "./academic-blue";
import { minimalTheme } from "./minimal";
import { techDarkAccentTheme } from "./tech-dark-accent";
import { warmEditorialTheme } from "./warm-editorial";

export const originalThemes: readonly ThemeDefinition[] = [
  minimalTheme,
  academicBlueTheme,
  warmEditorialTheme,
  techDarkAccentTheme,
];

const themeMap = new Map(originalThemes.map((theme) => [theme.id, theme]));

export function getOriginalTheme(themeId: string): ThemeDefinition | undefined {
  return themeMap.get(themeId);
}

const HEX_COLOR = /^#[\da-f]{6}$/i;

/**
 * Apply an optional primary colour without mutating the registered theme.
 * Invalid values fail closed to the original palette.
 */
export function themeCss(
  theme: ThemeDefinition,
  mode: ThemeMode,
  primaryColor?: string,
): string {
  const css = mode === "dark" ? theme.darkCss : theme.lightCss;
  if (!primaryColor || !HEX_COLOR.test(primaryColor)) return css;
  const sourceColor =
    mode === "dark" ? theme.darkPrimaryColor : theme.primaryColor;
  return css.replace(new RegExp(sourceColor, "gi"), primaryColor.toLowerCase());
}
