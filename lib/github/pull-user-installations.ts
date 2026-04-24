import "server-only";

import { Octokit } from "@octokit/rest";

import { decryptSecret } from "@/lib/auth/encrypt";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

import { isOctokitHttpError } from "./http-error-format";
import { importAllReposFromGitHubApi } from "./repository-upsert";

type GitHubUserInstallation = {
  id: number;
  app_id: number;
  suspended_at: string | null;
  account: { login: string; type: string };
};

/**
 * 用当前用户 OAuth token 调用 GitHub `GET /user/installations`，筛出本 App（`GITHUB_APP_ID`）的安装并 upsert，
 * 再对每个安装全量拉取仓库。用于**本机 localhost 收不到 Webhook** 时的补救。
 */
export async function pullInstallationsAndReposForUser(userId: string): Promise<{
  installationCount: number;
  repoCount: number;
}> {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const accessToken = decryptSecret(user.accessTokenEnc);
  const octokit = new Octokit({ auth: accessToken });

  const appId = env.GITHUB_APP_ID;
  const installations: GitHubUserInstallation[] = [];
  for (let page = 1; ; page += 1) {
    const { data } = await octokit.request("GET /user/installations", {
      per_page: 100,
      page,
      headers: { "X-GitHub-Api-Version": "2022-11-28" },
    });
    const pageItems: unknown[] = Array.isArray(data)
      ? data
      : data !== null &&
          typeof data === "object" &&
          "installations" in data &&
          Array.isArray((data as { installations: unknown }).installations)
        ? (data as { installations: unknown[] }).installations
        : [];
    if (pageItems.length === 0) {
      break;
    }
    for (const row of pageItems) {
      const rec = row as GitHubUserInstallation;
      if (rec.app_id === appId) {
        installations.push(rec);
      }
    }
    if (pageItems.length < 100) {
      break;
    }
  }

  let repoCount = 0;
  for (const inst of installations) {
    const suspendedAt =
      inst.suspended_at === null || inst.suspended_at === undefined
        ? null
        : new Date(inst.suspended_at);
    const row = await db.installation.upsert({
      where: { githubInstallationId: inst.id },
      create: {
        githubInstallationId: inst.id,
        userId: user.id,
        accountLogin: inst.account.login,
        accountType: inst.account.type,
        suspendedAt,
      },
      update: {
        userId: user.id,
        accountLogin: inst.account.login,
        accountType: inst.account.type,
        suspendedAt,
      },
    });
    const n = await importAllReposFromGitHubApi(row.id, inst.id);
    repoCount += n;
  }

  return { installationCount: installations.length, repoCount };
}

export function formatPullInstallationsError(e: unknown): { code: string; message: string } {
  if (isOctokitHttpError(e)) {
    if (e.status === 401 || e.status === 403) {
      return {
        code: "GITHUB_FORBIDDEN",
        message:
          "无法读取 GitHub 上的 App 安装列表。请重新登录，或到 GitHub 重新接受本应用所需权限。",
      };
    }
    return { code: "GITHUB_ERROR", message: e.message || "GitHub API 错误" };
  }
  if (e instanceof Error) {
    return { code: "INTERNAL", message: e.message };
  }
  return { code: "INTERNAL", message: "未知错误" };
}
