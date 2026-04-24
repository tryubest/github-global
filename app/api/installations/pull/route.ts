import { NextResponse } from "next/server";

import { jsonError } from "@/lib/api-error";
import { requireSession } from "@/lib/auth/guards";
import { formatPullInstallationsError, pullInstallationsAndReposForUser } from "@/lib/github/pull-user-installations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 从 GitHub 拉取当前用户可访问的「本 App」安装，并全量同步仓库（本机无 Webhook 时的主要补救入口）。
 */
export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireSession();
  if (!auth.ok) {
    return auth.response;
  }

  const contentType = request.headers.get("content-type") ?? "";
  const isForm =
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data");

  try {
    const result = await pullInstallationsAndReposForUser(auth.data.userId);
    if (isForm) {
      const q = new URLSearchParams();
      q.set("pull", "ok");
      q.set("installs", String(result.installationCount));
      q.set("repos", String(result.repoCount));
      return NextResponse.redirect(new URL(`/dashboard?${q.toString()}`, request.url), 303);
    }
    return NextResponse.json(result);
  } catch (e) {
    const { code, message } = formatPullInstallationsError(e);
    if (isForm) {
      const q = new URLSearchParams();
      q.set("pull", "err");
      q.set("reason", code);
      return NextResponse.redirect(new URL(`/dashboard?${q.toString()}`, request.url), 303);
    }
    const status = code === "GITHUB_FORBIDDEN" ? 403 : 500;
    return jsonError(status, code, message);
  }
}
