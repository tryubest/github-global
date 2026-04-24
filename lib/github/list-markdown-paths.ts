import "server-only";

import type { Octokit } from "@octokit/rest";
import micromatch from "micromatch";

import { splitRepoFullName } from "./split-repo";

function isIgnored(path: string, ignoreGlobs: unknown): boolean {
  if (!Array.isArray(ignoreGlobs) || ignoreGlobs.length === 0) {
    return false;
  }
  const globs = ignoreGlobs.filter((g): g is string => typeof g === "string" && g.length > 0);
  if (globs.length === 0) {
    return false;
  }
  return micromatch.isMatch(path, globs);
}

export type ListMarkdownOptions = {
  ignoreGlobs: unknown;
  pathGlob?: string;
  maxFiles: number;
};

/**
 * 基于默认分支 tree_sha 递归列出 .md 路径（已排序，已截断 maxFiles）。
 */
export async function listMarkdownPaths(
  octokit: Octokit,
  fullName: string,
  defaultBranch: string,
  options: ListMarkdownOptions,
): Promise<{ paths: string[]; treeSha: string }> {
  const { owner, repo } = splitRepoFullName(fullName);
  const ref = `heads/${defaultBranch}`;
  const { data: refData } = await octokit.git.getRef({ owner, repo, ref });
  const treeSha = refData.object.sha;
  const { data: tree } = await octokit.git.getTree({
    owner,
    repo,
    tree_sha: treeSha,
    recursive: "true",
  });

  const paths = new Set<string>();
  for (const item of tree.tree) {
    if (item.type !== "blob" || !item.path?.endsWith(".md")) {
      continue;
    }
    if (isIgnored(item.path, options.ignoreGlobs)) {
      continue;
    }
    if (options.pathGlob && !micromatch.isMatch(item.path, options.pathGlob)) {
      continue;
    }
    paths.add(item.path);
    if (paths.size >= options.maxFiles) {
      break;
    }
  }

  return { paths: [...paths].sort(), treeSha };
}
