import "server-only";

import type { Octokit } from "@octokit/rest";

export type TranslationFileBlob = { path: string; content: string };

export async function createTranslationPullRequest(params: {
  octokit: Octokit;
  owner: string;
  repo: string;
  defaultBranch: string;
  baseSha: string;
  branchName: string;
  title: string;
  body: string;
  files: TranslationFileBlob[];
}): Promise<{ prUrl: string; branchName: string }> {
  const { octokit, owner, repo, baseSha, branchName, title, body, files } = params;
  if (files.length === 0) {
    throw new Error("No files to commit");
  }

  const { data: baseCommit } = await octokit.git.getCommit({
    owner,
    repo,
    commit_sha: baseSha,
  });
  const baseTreeSha = baseCommit.tree.sha;

  const blobShas: { path: string; sha: string }[] = [];
  for (const f of files) {
    const { data: blob } = await octokit.git.createBlob({
      owner,
      repo,
      content: Buffer.from(f.content, "utf8").toString("base64"),
      encoding: "base64",
    });
    blobShas.push({ path: f.path, sha: blob.sha });
  }

  const { data: newTree } = await octokit.git.createTree({
    owner,
    repo,
    base_tree: baseTreeSha,
    tree: blobShas.map((b) => ({
      path: b.path,
      mode: "100644" as const,
      type: "blob" as const,
      sha: b.sha,
    })),
  });

  const { data: commit } = await octokit.git.createCommit({
    owner,
    repo,
    message: title,
    tree: newTree.sha,
    parents: [baseSha],
  });

  try {
    await octokit.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branchName}`,
      sha: commit.sha,
    });
  } catch {
    await octokit.git.updateRef({
      owner,
      repo,
      ref: `heads/${branchName}`,
      sha: commit.sha,
      force: true,
    });
  }

  const { data: pr } = await octokit.pulls.create({
    owner,
    repo,
    title,
    head: branchName,
    base: params.defaultBranch,
    body,
  });

  return { prUrl: pr.html_url, branchName };
}
