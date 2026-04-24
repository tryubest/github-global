import "server-only";

import type { Octokit } from "@octokit/rest";

export async function fetchRepoFileUtf8(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  ref: string,
): Promise<string> {
  const { data } = await octokit.repos.getContent({ owner, repo, path, ref });
  if (Array.isArray(data) || !("content" in data)) {
    throw new Error(`Path is not a single file: ${path}`);
  }
  return Buffer.from(data.content, "base64").toString("utf8");
}
