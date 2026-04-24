import { after, NextResponse } from "next/server";

import { jsonError } from "@/lib/api-error";
import { env } from "@/lib/env";
import { claimNextPendingJob, runTranslationJobById } from "@/lib/worker";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request): Promise<NextResponse> {
  const secret = request.headers.get("x-cron-secret");
  if (!secret || secret !== env.CRON_SECRET) {
    return jsonError(401, "UNAUTHORIZED", "无效的 x-cron-secret");
  }

  const jobId = await claimNextPendingJob();
  if (!jobId) {
    return NextResponse.json({ processed: false, message: "无 pending 任务" });
  }

  /** 翻译 + 开 PR 可能耗时数分钟；先响应 JSON，避免 curl 长时间无输出；进度在任务页轮询。 */
  after(async () => {
    try {
      await runTranslationJobById(jobId);
    } catch (e) {
      console.error("[worker/tick] runTranslationJobById", jobId, e);
    }
  });

  return NextResponse.json({
    processed: true,
    jobId,
    message: "任务已开始处理，请打开任务页查看进度（可能需要数分钟）",
  });
}
