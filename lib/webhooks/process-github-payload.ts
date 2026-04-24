import "server-only";

import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { importAllReposFromGitHubApi, removeRepositoriesByGithubId, upsertRepositoriesForInstallation, type GhRepositoryStub } from "@/lib/github/repository-upsert";

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function mapRepo(r: unknown): GhRepositoryStub | null {
  if (!isRecord(r)) {
    return null;
  }
  if (typeof r.id !== "number" || typeof r.full_name !== "string" || typeof r.private !== "boolean") {
    return null;
  }
  const def = r.default_branch;
  return {
    id: r.id,
    full_name: r.full_name,
    private: r.private,
    default_branch: typeof def === "string" ? def : "main",
  };
}

function mapRepoList(v: unknown): GhRepositoryStub[] {
  if (!Array.isArray(v)) {
    return [];
  }
  return v.map(mapRepo).filter((x): x is GhRepositoryStub => x !== null);
}

function installAccountFields(install: Record<string, unknown>): { login: string; type: string } {
  const acc = install.account;
  if (!isRecord(acc)) {
    return { login: "unknown", type: "User" };
  }
  const login = typeof acc.login === "string" ? acc.login : "unknown";
  const type = typeof acc.type === "string" ? acc.type : "User";
  return { login, type };
}

/**
 * 在 WebhookEvent 行已写入后执行：处理 installation* 同步并标记 processed；push 等保持 pending；ping 标记已收条。
 */
export async function runWebhookSideEffects(params: {
  webhookEventId: string;
  eventName: string;
  /** 已 parse 的 JSON */
  payload: unknown;
}): Promise<void> {
  const { webhookEventId, eventName, payload } = params;

  if (eventName === "ping") {
    await db.webhookEvent.update({
      where: { id: webhookEventId },
      data: { status: "processed", processedAt: new Date() },
    });
    return;
  }

  if (eventName !== "installation" && eventName !== "installation_repositories") {
    return;
  }

  let internalInstallationId: string | undefined;
  try {
    if (eventName === "installation") {
      internalInstallationId = await handleInstallationEvent(payload);
    } else {
      internalInstallationId = await handleInstallationRepositoriesEvent(payload);
    }
    await db.webhookEvent.update({
      where: { id: webhookEventId },
      data: {
        status: "processed",
        processedAt: new Date(),
        installationId: internalInstallationId,
        errorMessage: null,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const errorMessage = msg.length > 2000 ? `${msg.slice(0, 2000)}…` : msg;
    await db.webhookEvent.update({
      where: { id: webhookEventId },
      data: { status: "failed", errorMessage, processedAt: new Date() },
    });
  }
}

async function findGitHubSenderId(payload: unknown): Promise<number> {
  if (!isRecord(payload) || !isRecord(payload.sender) || typeof payload.sender.id !== "number") {
    throw new Error("缺少 sender id");
  }
  return payload.sender.id;
}

async function handleInstallationEvent(payload: unknown): Promise<string | undefined> {
  if (!isRecord(payload) || !isRecord(payload.installation)) {
    throw new Error("非法 installation 载荷");
  }
  const action = payload.action;
  const gh = payload.installation;
  if (typeof gh.id !== "number") {
    throw new Error("缺少 installation id");
  }
  const githubInstallationId = gh.id;
  const { login: accountLogin, type: accountType } = installAccountFields(gh);

  if (action === "deleted") {
    await db.installation.deleteMany({ where: { githubInstallationId } });
    return undefined;
  }

  if (action === "suspend") {
    const row = await db.installation.findUnique({ where: { githubInstallationId } });
    if (row) {
      await db.installation.update({
        where: { id: row.id },
        data: { suspendedAt: new Date() },
      });
    }
    return row?.id;
  }

  if (action === "unsuspend") {
    const row = await db.installation.findUnique({ where: { githubInstallationId } });
    if (row) {
      await db.installation.update({ where: { id: row.id }, data: { suspendedAt: null } });
    }
    return row?.id;
  }

  if (action === "created" || action === "new_permissions_accepted") {
    const senderId = await findGitHubSenderId(payload);
    const user = await db.user.findUnique({ where: { githubId: senderId } });
    if (!user) {
      throw new Error("安装发起者未在本站注册：请先使用 GitHub 登录后再安装 App");
    }
    const inst = await db.installation.upsert({
      where: { githubInstallationId },
      create: {
        githubInstallationId,
        userId: user.id,
        accountLogin,
        accountType,
        suspendedAt: null,
      },
      update: { userId: user.id, accountLogin, accountType, suspendedAt: null },
    });

    const fromPayload = mapRepoList(payload.repositories);
    if (fromPayload.length > 0) {
      await upsertRepositoriesForInstallation(inst.id, fromPayload);
    } else {
      await importAllReposFromGitHubApi(inst.id, githubInstallationId);
    }
    return inst.id;
  }

  return undefined;
}

async function handleInstallationRepositoriesEvent(payload: unknown): Promise<string | undefined> {
  if (!isRecord(payload) || !isRecord(payload.installation) || typeof payload.action !== "string") {
    throw new Error("非法 installation_repositories 载荷");
  }
  if (typeof payload.installation.id !== "number") {
    throw new Error("缺少 installation id");
  }
  const githubInstallationId = payload.installation.id;
  const inst = await db.installation.findUnique({ where: { githubInstallationId } });
  if (!inst) {
    return undefined;
  }

  if (payload.action === "added") {
    const list = mapRepoList(payload.repositories_added);
    if (list.length > 0) {
      await upsertRepositoriesForInstallation(inst.id, list);
    }
  } else if (payload.action === "removed") {
    const raw = payload.repositories_removed;
    if (!Array.isArray(raw)) {
      return inst.id;
    }
    const ids: number[] = [];
    for (const r of raw) {
      if (isRecord(r) && typeof r.id === "number") {
        ids.push(r.id);
      }
    }
    await removeRepositoriesByGithubId(inst.id, ids);
  }

  return inst.id;
}

export function isPrismaUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}
