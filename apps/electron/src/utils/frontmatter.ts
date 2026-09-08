export interface FrontmatterMeta {
    themeName: string;
    themeId?: string;
    title?: string;
    status?: string;
    slug?: string;
}

const FRONTMATTER_REGEX = /^(\uFEFF)?---(\r?\n)([\s\S]*?)\2---(?:\r?\n|$)/;

function parseFrontmatterValue(raw?: string): string | undefined {
    if (!raw) return undefined;
    const trimmed = raw.trim();
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        const quote = trimmed[0];
        const inner = trimmed.slice(1, -1);
        if (quote === '"') {
            return inner.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        }
        return inner.replace(/\\'/g, "'");
    }
    return trimmed;
}

export function extractFrontmatterMeta(content: string): FrontmatterMeta {
    const fallback: FrontmatterMeta = { themeName: '默认主题' };
    const match = content.match(FRONTMATTER_REGEX);
    if (!match) return fallback;

    const frontmatter = match[3];
    const themeMatch = frontmatter.match(/themeName:\s*(.+)/);
    const themeIdMatch = frontmatter.match(/^theme:\s*(.+)$/m);
    const titleMatch = frontmatter.match(/title:\s*(.+)/);
    const statusMatch = frontmatter.match(/^status:\s*(.+)$/m);
    const slugMatch = frontmatter.match(/^slug:\s*(.+)$/m);

    return {
        themeName: parseFrontmatterValue(themeMatch?.[1]) || fallback.themeName,
        themeId: parseFrontmatterValue(themeIdMatch?.[1]) || undefined,
        title: parseFrontmatterValue(titleMatch?.[1]) || undefined,
        status: parseFrontmatterValue(statusMatch?.[1]) || undefined,
        slug: parseFrontmatterValue(slugMatch?.[1]) || undefined,
    };
}
