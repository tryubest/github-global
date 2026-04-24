import { NextResponse } from "next/server";

import { jsonError } from "@/lib/api-error";
import { requireSession } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { githubBlobWebUrl, translatedFilePath } from "@/lib/github/split-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireSession();
  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await context.params;

  const job = await db.translationJob.findFirst({
    where: {
      id,
      repository: { installation: { userId: auth.data.userId } },
    },
    include: {
      repository: { select: { id: true, fullName: true, defaultBranch: true } },
      files: { orderBy: [{ path: "asc" }, { lang: "asc" }] },
    },
  });

  if (!job) {
    return jsonError(404, "NOT_FOUND", "任务不存在或无权查看");
  }

  const fullName = job.repository.fullName;
  const defaultBranch = job.repository.defaultBranch;
  const prBranch = job.branchName;

  return NextResponse.json({
    job: {
      id: job.id,
      status: job.status,
      trigger: job.trigger,
      targetLangs: job.targetLangs,
      modelId: job.modelId,
      branchName: job.branchName,
      prUrl: job.prUrl,
      totalFiles: job.totalFiles,
      doneFiles: job.doneFiles,
      failedFiles: job.failedFiles,
      errorMessage: job.errorMessage,
      queuedAt: job.queuedAt.toISOString(),
      startedAt: job.startedAt?.toISOString() ?? null,
      finishedAt: job.finishedAt?.toISOString() ?? null,
      commitSha: job.commitSha,
      repository: job.repository,
    },
    files: job.files.map((f) => {
      const outPath = translatedFilePath(f.path, f.lang);
      return {
        id: f.id,
        path: f.path,
        translatedPath: outPath,
        lang: f.lang,
        status: f.status,
        skipReason: f.skipReason,
        errorMessage: f.errorMessage,
        tokensIn: f.tokensIn,
        tokensOut: f.tokensOut,
        durationMs: f.durationMs,
        modelUsed: f.modelUsed,
        sourceViewUrl: githubBlobWebUrl(fullName, defaultBranch, f.path),
        /** 仅成功写入 PR 分支的文件可打开；跳过/失败的本 PR 中不存在该 blob。 */
        translatedViewUrl:
          prBranch && f.status === "succeeded"
            ? githubBlobWebUrl(fullName, prBranch, outPath)
            : null,
      };
    }),
  });
}
