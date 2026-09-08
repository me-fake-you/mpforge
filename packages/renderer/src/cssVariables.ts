/**
 * Resolve custom properties without requiring a DOM. This is intentionally
 * small and conservative: it handles the CSS emitted by the theme designer,
 * including fallbacks and nested var() references, while preserving unknown
 * functions and values.
 */
export function expandCssVariables(css: string): string {
  if (!css || !css.includes("var(")) return css;

  const properties = new Map<string, string>();
  const declarationPattern = /(--[\w-]+)\s*:\s*([^;{}]+)\s*;?/g;
  for (const match of css.matchAll(declarationPattern)) {
    properties.set(match[1], match[2].trim());
  }

  const resolveValue = (value: string, stack: Set<string>): string => {
    return value.replace(
      /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g,
      (whole, name: string, fallback?: string) => {
        if (stack.has(name)) return fallback?.trim() ?? whole;
        const raw = properties.get(name);
        if (raw === undefined) return fallback?.trim() ?? whole;
        const next = new Set(stack);
        next.add(name);
        const resolved = resolveValue(raw, next);
        return resolved.includes("var(") && fallback
          ? fallback.trim()
          : resolved;
      },
    );
  };

  let expanded = css.replace(/var\(/g, "var(");
  for (let pass = 0; pass < 12 && expanded.includes("var("); pass += 1) {
    const before = expanded;
    expanded = expanded.replace(
      /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g,
      (whole, name: string, fallback?: string) => {
        const raw = properties.get(name);
        if (raw === undefined) return fallback?.trim() ?? whole;
        return resolveValue(raw, new Set([name]));
      },
    );
    if (before === expanded) break;
  }

  // Custom properties are not useful after substitution and can be left
  // behind by CSS serializers, so remove only declaration-shaped properties.
  return expanded.replace(/\s*--[\w-]+\s*:\s*[^;{}]+;?/g, "");
}
