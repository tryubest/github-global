import { NextResponse } from "next/server";
import { z } from "zod";

import { jsonError } from "@/lib/api-error";
import { requireRepositoryForUser, requireSession } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getOctokitForInstallation } from "@/lib/github/app-install-octokit";
import { listMarkdownPaths } from "@/lib/github/list-markdown-paths";
import { JOB_TARGET_LANGS } from "@/lib/jobs/target-langs";
import { MAX_FILES_PER_JOB } from "@/lib/worker/run-translation-job";

export const runtime = "nodejs";
export const maxDuration = 60;

const targetLangItem = z.enum(JOB_TARGET_LANGS);

const createJobSchema = z.object({
  repositoryId: z.string().min(1),
  targetLangs: z.array(targetLangItem).min(1).max(7),
  modelId: z.string().min(1).optional(),
  pathGlob: z.string().min(1).optional(),
});

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireSession();
  if (!auth.ok) {
    return auth.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(422, "INVALID_JSON", "请求体须为 JSON");
  }

  const parsed = createJobSchema.safeParse(body);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => i.message).join("；");
    return jsonError(422, "VALIDATION_ERROR", msg || "参数不合法");
  }

  const { repositoryId, targetLangs, modelId, pathGlob } = parsed.data;

  const repoGate = await requireRepositoryForUser(repositoryId, auth.data.userId);
  if (!repoGate.ok) {
    return repoGate.response;
  }

  const repo = repoGate.repo;
  const model = (modelId?.trim() || env.TRANSLATION_MODEL_PRIMARY).trim();

  let octokit;
  try {
    octokit = await getOctokitForInstallation(repo.installation.githubInstallationId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonError(502, "GITHUB_AUTH", `无法获取安装令牌：${msg}`);
  }

  const { paths, treeSha } = await listMarkdownPaths(octokit, repo.fullName, repo.defaultBranch, {
    ignoreGlobs: repo.config?.ignoreGlobs ?? [],
    pathGlob,
    maxFiles: MAX_FILES_PER_JOB,
  });

  if (paths.length === 0) {
    return jsonError(400, "NO_MARKDOWN", "未找到符合条件的 Markdown 文件");
  }

  const totalFiles = paths.length * targetLangs.length;

  const job = await db.$transaction(async (tx) => {
    const j = await tx.translationJob.create({
      data: {
        repositoryId: repo.id,
        userId: auth.data.userId,
        status: "pending",
        trigger: "manual",
        commitSha: treeSha,
        targetLangs,
        modelId: model,
        totalFiles,
      },
    });

    const rows = [];
    for (const path of paths) {
      for (const lang of targetLangs) {
        rows.push({
          jobId: j.id,
          repositoryId: repo.id,
          path,
          lang,
        });
      }
    }
    await tx.fileTranslation.createMany({ data: rows });
    return j;
  });

  return NextResponse.json({
    jobId: job.id,
    totalFiles: job.totalFiles,
    pathsPreview: paths.slice(0, 5),
  });
}
