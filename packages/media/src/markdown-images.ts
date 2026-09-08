export type MarkdownImageKind = "markdown" | "reference" | "html";

export interface MarkdownImageReference {
  original: string;
  source: string;
  alt: string;
  line: number;
  column: number;
  kind: MarkdownImageKind;
  remote: boolean;
}

function isRemote(source: string): boolean {
  return /^https?:\/\//i.test(source) || source.startsWith("//");
}

/** Deterministic discovery only. This function performs no file or network I/O. */
export function scanMarkdownImageReferences(
  markdown: string,
): MarkdownImageReference[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const definitions = new Map<string, string>();
  let fenced = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const definition = line.match(/^\s*\[([^\]]+)]\s*:\s*(?:<([^>]+)>|(\S+))/);
    if (definition)
      definitions.set(
        definition[1].trim().toLowerCase(),
        definition[2] ?? definition[3],
      );
  }

  const results: MarkdownImageReference[] = [];
  fenced = false;
  lines.forEach((line, lineIndex) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return;
    }
    if (fenced) return;
    const occupied: Array<[number, number]> = [];
    const inline =
      /!\[([^\]]*)]\((?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\)/g;
    let match: RegExpExecArray | null;
    while ((match = inline.exec(line))) {
      const source = (match[2] ?? match[3]).trim();
      results.push({
        original: match[0],
        source,
        alt: match[1],
        line: lineIndex + 1,
        column: match.index + 1,
        kind: "markdown",
        remote: isRemote(source),
      });
      occupied.push([match.index, match.index + match[0].length]);
    }
    const reference = /!\[([^\]]*)]\[([^\]]*)]/g;
    while ((match = reference.exec(line))) {
      if (
        occupied.some(
          ([start, end]) => match!.index >= start && match!.index < end,
        )
      )
        continue;
      const label = (match[2] || match[1]).trim().toLowerCase();
      const source = definitions.get(label);
      if (!source) continue;
      results.push({
        original: match[0],
        source,
        alt: match[1],
        line: lineIndex + 1,
        column: match.index + 1,
        kind: "reference",
        remote: isRemote(source),
      });
    }
    const html = /<img\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1[^>]*>/gi;
    while ((match = html.exec(line))) {
      const tag = match[0];
      const altMatch = tag.match(/\balt\s*=\s*(["'])(.*?)\1/i);
      const source = match[2].trim();
      results.push({
        original: tag,
        source,
        alt: altMatch?.[2] ?? "",
        line: lineIndex + 1,
        column: match.index + 1,
        kind: "html",
        remote: isRemote(source),
      });
    }
  });
  return results.sort(
    (left, right) => left.line - right.line || left.column - right.column,
  );
}
