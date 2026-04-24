import "server-only";

import { createHash } from "node:crypto";

import { db } from "@/lib/db";
import { createTranslationPullRequest } from "@/lib/github/create-translation-pr";
import { fetchRepoFileUtf8 } from "@/lib/github/fetch-repo-file";
import { getOctokitForInstallation } from "@/lib/github/app-install-octokit";
import { splitRepoFullName, translatedFilePath } from "@/lib/github/split-repo";
import { translateMarkdownDocument } from "@/lib/translator";

const MAX_FILES_PER_JOB = 12;

export { MAX_FILES_PER_JOB };

function sha256Utf8(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export async function claimNextPendingJob(): Promise<string | null> {
  const claimed = await db.$transaction(async (tx) => {
    const next = await tx.translationJob.findFirst({
      where: { status: "pending" },
      orderBy: { queuedAt: "asc" },
      select: { id: true },
    });
    if (!next) {
      return null;
    }
    const updated = await tx.translationJob.updateMany({
      where: { id: next.id, status: "pending" },
      data: { status: "running", startedAt: new Date() },
    });
    if (updated.count !== 1) {
      return null;
    }
    return next.id;
  });
  return claimed;
}

export async function runTranslationJobById(jobId: string): Promise<void> {
  const job = await db.translationJob.findUnique({
    where: { id: jobId },
    include: {
      repository: { include: { installation: true, config: true } },
      files: { orderBy: [{ path: "asc" }, { lang: "asc" }] },
    },
  });

  if (!job || job.status !== "running") {
    return;
  }

  const repo = job.repository;
  const { owner, repo: repoName } = splitRepoFullName(repo.fullName);
  const ref = job.commitSha ?? repo.defaultBranch;

  let octokit;
  try {
    octokit = await getOctokitForInstallation(repo.installation.githubInstallationId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.translationJob.update({
      where: { id: jobId },
      data: {
        status: "failed",
        finishedAt: new Date(),
        errorMessage: `GitHub 安装令牌失败：${msg}`,
      },
    });
    return;
  }

  const prFiles: { path: string; content: string }[] = [];
  let hadSuccess = false;
  let hadFailure = false;

  for (const fileRow of job.files) {
    const started = Date.now();
    await db.fileTranslation.update({
      where: { id: fileRow.id },
      data: { status: "running", startedAt: new Date() },
    });

    try {
      const source = await fetchRepoFileUtf8(octokit, owner, repoName, fileRow.path, ref);
      const sourceHash = sha256Utf8(source);

      const duplicate = await db.fileTranslation.findFirst({
        where: {
          repositoryId: repo.id,
          path: fileRow.path,
          lang: fileRow.lang,
          sourceHash,
          status: "succeeded",
        },
      });

      if (duplicate) {
        await db.fileTranslation.update({
          where: { id: fileRow.id },
          data: {
            sourceHash,
            status: "skipped",
            skipReason: "hash-match",
            finishedAt: new Date(),
            durationMs: Date.now() - started,
          },
        });
        await db.translationJob.update({
          where: { id: jobId },
          data: { doneFiles: { increment: 1 } },
        });
        continue;
      }

      const result = await translateMarkdownDocument(source, fileRow.lang, job.modelId);
      if (!result.ok) {
        hadFailure = true;
        await db.fileTranslation.update({
          where: { id: fileRow.id },
          data: {
            sourceHash,
            status: "failed",
            errorMessage: result.message,
            finishedAt: new Date(),
            durationMs: Date.now() - started,
          },
        });
        await db.translationJob.update({
          where: { id: jobId },
          data: { doneFiles: { increment: 1 }, failedFiles: { increment: 1 } },
        });
        continue;
      }

      const translatedHash = sha256Utf8(result.markdown);
      const outPath = translatedFilePath(fileRow.path, fileRow.lang);
      prFiles.push({ path: outPath, content: result.markdown });
      hadSuccess = true;

      await db.fileTranslation.update({
        where: { id: fileRow.id },
        data: {
          sourceHash,
          translatedHash,
          status: "succeeded",
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          durationMs: Date.now() - started,
          finishedAt: new Date(),
          modelUsed: result.modelUsed,
        },
      });
      await db.translationJob.update({
        where: { id: jobId },
        data: { doneFiles: { increment: 1 } },
      });
    } catch (e) {
      hadFailure = true;
      const message = e instanceof Error ? e.message : String(e);
      await db.fileTranslation.update({
        where: { id: fileRow.id },
        data: {
          status: "failed",
          errorMessage: message,
          finishedAt: new Date(),
          durationMs: Date.now() - started,
        },
      });
      await db.translationJob.update({
        where: { id: jobId },
        data: { doneFiles: { increment: 1 }, failedFiles: { increment: 1 } },
      });
    }
  }

  if (!hadSuccess) {
    await db.translationJob.update({
      where: { id: jobId },
      data: {
        status: "failed",
        finishedAt: new Date(),
        errorMessage: "没有可提交的译文（全部失败或跳过）",
      },
    });
    return;
  }

  const branchName = `i18n/gh-global-${jobId.replace(/[^a-z0-9-]/gi, "").slice(0, 14)}`;
  const title = `[i18n] Automated translation (${job.targetLangs.join(", ")})`;
  const fileRows = await db.fileTranslation.findMany({
    where: { jobId },
    orderBy: [{ path: "asc" }, { lang: "asc" }],
  });
  const bodyLines = [
    "此 PR 由 **GitHub Global** 自动生成。",
    "",
    "请在合并前审阅 AI 译文。",
    "",
    "| 文件 | 状态 |",
    "| --- | --- |",
    ...fileRows.map((f) => {
      const icon =
        f.status === "succeeded" ? "✅" : f.status === "skipped" ? "⏭️" : "❌";
      return `| \`${f.path}\` (${f.lang}) | ${icon} ${f.status}${f.skipReason ? ` (${f.skipReason})` : ""}${f.errorMessage ? ` — ${f.errorMessage}` : ""} |`;
    }),
  ];

  try {
    const baseSha =
      job.commitSha ??
      (
        await octokit.git.getRef({
          owner,
          repo: repoName,
          ref: `heads/${repo.defaultBranch}`,
        })
      ).data.object.sha;

    const { prUrl } = await createTranslationPullRequest({
      octokit,
      owner,
      repo: repoName,
      defaultBranch: repo.defaultBranch,
      baseSha,
      branchName,
      title,
      body: bodyLines.join("\n"),
      files: prFiles,
    });

    const finalStatus = hadFailure ? "succeeded_with_errors" : "succeeded";
    await db.translationJob.update({
      where: { id: jobId },
      data: {
        status: finalStatus,
        prUrl,
        branchName,
        finishedAt: new Date(),
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db.translationJob.update({
      where: { id: jobId },
      data: {
        status: "failed",
        finishedAt: new Date(),
        errorMessage: `创建 PR 失败：${message}`,
        branchName,
      },
    });
  }
}
