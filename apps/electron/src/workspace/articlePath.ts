import * as fs from "node:fs";
import * as path from "node:path";
import { getWorkspaceDir, isPathInsideWorkspace } from "./state";

export function resolveWorkspaceArticleDirectory(articlePath: string): string {
  const workspace = getWorkspaceDir();
  if (!workspace) throw new Error("NO_WORKSPACE: Select a workspace first.");
  if (
    typeof articlePath !== "string" ||
    path.basename(articlePath) !== "article.md"
  ) {
    throw new Error("INVALID_ARTICLE_PATH: Expected an article.md path.");
  }
  const absoluteArticle = path.isAbsolute(articlePath)
    ? path.resolve(articlePath)
    : path.resolve(workspace, articlePath);
  if (!isPathInsideWorkspace(absoluteArticle)) {
    throw new Error(
      "PATH_OUTSIDE_WORKSPACE: Article path escaped the workspace.",
    );
  }
  const realArticle = fs.realpathSync(absoluteArticle);
  if (
    !isPathInsideWorkspace(realArticle) ||
    !fs.statSync(realArticle).isFile()
  ) {
    throw new Error("INVALID_ARTICLE_PATH: Article is not a workspace file.");
  }
  return fs.realpathSync(path.dirname(realArticle));
}
