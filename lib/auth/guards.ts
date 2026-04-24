import "server-only";

import { jsonError } from "@/lib/api-error";
import { getSessionForRequest } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";

import type { Installation, RepoConfig, Repository, User } from "@prisma/client";

export type Authed = {
  userId: string;
  user: User;
  sessionId: string;
};

export async function requireSession(): Promise<
  | { ok: true; data: Authed }
  | { ok: false; response: NextResponse }
> {
  const s = await getSessionForRequest();
  if (!s) {
    return { ok: false, response: jsonError(401, "UNAUTHORIZED", "需要登录") };
  }
  return {
    ok: true,
    data: { userId: s.userId, user: s.user, sessionId: s.sessionId },
  };
}

export type RepositoryWithAccess = Repository & {
  installation: Installation;
  config: RepoConfig | null;
};

/** 创建翻译任务前：归属、暂停、公开仓库（TD-01）。 */
export async function requireRepositoryForUser(
  repositoryId: string,
  userId: string,
): Promise<
  { ok: true; repo: RepositoryWithAccess } | { ok: false; response: NextResponse }
> {
  const repo = await db.repository.findFirst({
    where: { id: repositoryId, installation: { userId } },
    include: { installation: true, config: true },
  });
  if (!repo) {
    return { ok: false, response: jsonError(404, "NOT_FOUND", "仓库不存在或无权访问") };
  }
  if (repo.installation.suspendedAt) {
    return { ok: false, response: jsonError(403, "SUSPENDED", "安装实例已暂停") };
  }
  if (repo.private) {
    return { ok: false, response: jsonError(403, "PRIVATE_REPO", "MVP 仅支持公开仓库") };
  }
  return { ok: true, repo };
}
