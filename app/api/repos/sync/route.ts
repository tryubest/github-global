import { NextResponse } from "next/server";
import { z } from "zod";

import { jsonError } from "@/lib/api-error";
import { requireSession } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { formatInstallationReposListError } from "@/lib/github/http-error-format";
import { importAllReposFromGitHubApi } from "@/lib/github/repository-upsert";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  installationId: z.string().min(1),
});

function redirectSyncError(request: Request, message: string): NextResponse {
  const u = new URL("/dashboard", request.url);
  u.searchParams.set("sync", "err");
  const short = message.length > 1200 ? `${message.slice(0, 1200)}…` : message;
  u.searchParams.set("reason", short);
  return NextResponse.redirect(u, 303);
}

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireSession();
  if (!auth.ok) {
    return auth.response;
  }

  const contentType = request.headers.get("content-type") ?? "";
  const isForm =
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data");
  let installationIdRaw: unknown;
  if (isForm) {
    const fd = await request.formData();
    installationIdRaw = fd.get("installationId");
  } else {
    try {
      const body: unknown = await request.json();
      installationIdRaw =
        body !== null && typeof body === "object" && "installationId" in body
          ? (body as { installationId: unknown }).installationId
          : undefined;
    } catch {
      return jsonError(422, "INVALID_JSON", "请求体须为 JSON 或表单");
    }
  }

  const parsed = bodySchema.safeParse({ installationId: installationIdRaw });
  if (!parsed.success) {
    return jsonError(422, "VALIDATION_ERROR", "参数不合法");
  }

  let inst;
  try {
    inst = await db.installation.findFirst({
      where: { id: parsed.data.installationId, userId: auth.data.userId },
    });
  } catch (e) {
    console.error("[repos/sync] database error", e);
    if (isForm) {
      return redirectSyncError(request, "数据库连接失败，请检查 DATABASE_URL 与迁移是否已执行");
    }
    return jsonError(503, "DATABASE_ERROR", "数据库不可用");
  }

  if (!inst) {
    return jsonError(404, "NOT_FOUND", "未找到安装或无权访问");
  }

  let synced: number;
  try {
    synced = await importAllReposFromGitHubApi(inst.id, inst.githubInstallationId);
  } catch (e) {
    console.error("[repos/sync] importAllReposFromGitHubApi", e);
    const { message } = formatInstallationReposListError(e);
    if (isForm) {
      return redirectSyncError(request, message);
    }
    return jsonError(502, "GITHUB_SYNC_FAILED", message);
  }

  if (isForm) {
    return NextResponse.redirect(new URL("/dashboard?sync=ok", request.url), 303);
  }
  return NextResponse.json({ synced });
}
