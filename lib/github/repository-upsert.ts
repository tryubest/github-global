import "server-only";

import { db } from "@/lib/db";

import { getOctokitForInstallation } from "./app-install-octokit";

/** GitHub API / Webhook 仓库摘要（字段名统一为小写加下划线） */
export type GhRepositoryStub = {
  id: number;
  full_name: string;
  private: boolean;
  default_branch?: string | null;
};

/**
 * 将 Webhook 或 REST 列出的仓库写入本站；新建 `RepoConfig` 默认值。
 */
export async function upsertRepositoriesForInstallation(
  internalInstallationId: string,
  repos: GhRepositoryStub[],
): Promise<number> {
  let n = 0;
  for (const r of repos) {
    await db.repository.upsert({
      where: { githubRepoId: r.id },
      create: {
        githubRepoId: r.id,
        installationId: internalInstallationId,
        fullName: r.full_name,
        private: r.private,
        defaultBranch: r.default_branch?.trim() ? r.default_branch : "main",
        config: { create: {} },
      },
      update: {
        installationId: internalInstallationId,
        fullName: r.full_name,
        private: r.private,
        defaultBranch: r.default_branch?.trim() ? r.default_branch! : "main",
      },
    });
    const row = await db.repository.findUnique({
      where: { githubRepoId: r.id },
      include: { config: true },
    });
    if (row && !row.config) {
      await db.repoConfig.create({ data: { repositoryId: row.id } });
    }
    n += 1;
  }
  return n;
}

/**
 * 从本站移除一组 GitHub 仓库 id（如 installation_repositories removed）。
 */
export async function removeRepositoriesByGithubId(
  internalInstallationId: string,
  githubRepoIds: number[],
): Promise<number> {
  if (githubRepoIds.length === 0) {
    return 0;
  }
  const res = await db.repository.deleteMany({
    where: { installationId: internalInstallationId, githubRepoId: { in: githubRepoIds } },
  });
  return res.count;
}

/**
 * 调用 GitHub `GET /installation/repositories` 全量拉取后 upsert（payload 中无仓库列表时使用）。
 */
export async function importAllReposFromGitHubApi(
  internalInstallationId: string,
  githubInstallationId: number,
): Promise<number> {
  const octokit = await getOctokitForInstallation(githubInstallationId);
  const collected: GhRepositoryStub[] = [];
  for (let page = 1; ; page += 1) {
    const { data } = await octokit.rest.apps.listReposAccessibleToInstallation({
      per_page: 100,
      page,
    });
    for (const r of data.repositories) {
      collected.push({
        id: r.id,
        full_name: r.full_name,
        private: r.private,
        default_branch: r.default_branch,
      });
    }
    if (data.repositories.length < 100) {
      break;
    }
  }
  return upsertRepositoriesForInstallation(internalInstallationId, collected);
}
