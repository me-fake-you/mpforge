import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  ".gif",
  ".jpeg",
  ".jpg",
  ".png",
  ".svg",
  ".webp",
]);

export interface LocalAssetFileEntry {
  name: string;
  path: string;
  isDirectory: false;
  createdAt: Date;
  updatedAt: Date;
  size: number;
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

async function collect(
  articleRoot: string,
  directory: string,
  output: LocalAssetFileEntry[],
): Promise<void> {
  let resolvedDirectory: string;
  try {
    resolvedDirectory = await realpath(directory);
  } catch {
    return;
  }
  if (!isInside(articleRoot, resolvedDirectory)) return;

  const entries = await readdir(resolvedDirectory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
    const candidate = path.join(resolvedDirectory, entry.name);
    if (entry.isDirectory()) {
      await collect(articleRoot, candidate, output);
      continue;
    }
    if (
      !entry.isFile() ||
      !SUPPORTED_IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
    ) {
      continue;
    }
    const resolvedFile = await realpath(candidate);
    if (!isInside(articleRoot, resolvedFile)) continue;
    const metadata = await stat(resolvedFile);
    output.push({
      name: entry.name,
      path: resolvedFile,
      isDirectory: false,
      createdAt: metadata.birthtime,
      updatedAt: metadata.mtime,
      size: metadata.size,
    });
  }
}

/** Read-only inventory used by the renderer to validate local image existence. */
export async function listArticleAssetFiles(
  articleDirectory: string,
): Promise<LocalAssetFileEntry[]> {
  const root = await realpath(path.resolve(articleDirectory));
  const output: LocalAssetFileEntry[] = [];
  await collect(root, path.join(root, "assets"), output);
  await collect(root, path.join(root, "build", "assets"), output);
  return output.sort((left, right) => left.path.localeCompare(right.path));
}
