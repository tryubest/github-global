"use client";

import Link from "next/link";
import { useEffect, useState, type ReactElement } from "react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type JobFile = {
  id: string;
  path: string;
  translatedPath: string;
  lang: string;
  status: string;
  skipReason: string | null;
  errorMessage: string | null;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
  modelUsed: string | null;
  sourceViewUrl: string;
  translatedViewUrl: string | null;
};

type JobPayload = {
  id: string;
  status: string;
  targetLangs: string[];
  /** 创建任务时的首选模型；单文件实际模型见每行的 modelUsed */
  modelId: string;
  branchName: string | null;
  prUrl: string | null;
  totalFiles: number;
  doneFiles: number;
  failedFiles: number;
  errorMessage: string | null;
  startedAt: string | null;
  repository: { fullName: string; defaultBranch: string };
};

type JobPollProps = { jobId: string };

const terminal = new Set(["succeeded", "succeeded_with_errors", "failed", "cancelled"]);

const STATUS_HINT: Record<string, string> = {
  queued: "排队中，等待 Worker 处理。",
  running: "正在请求模型翻译或写入结果。",
  succeeded: "本文件已成功生成译文并（若任务整体成功）纳入 PR。",
  failed: "本文件处理失败，下方有具体原因（模型错误、结构校验失败等）。",
  skipped: "未再翻译：通常因与历史成功记录内容哈希相同（skipReason）。",
};

const SKIP_REASON_HINT: Record<string, string> = {
  "hash-match": "该路径+语言下，当前原文与已成功翻译过的版本相同，跳过以省成本。",
  ignored: "被仓库忽略规则排除。",
  oversized: "超出单文件大小/字数上限。",
};

function formatElapsedMs(startedAtIso: string | null, _rerenderTick: number): string {
  if (!startedAtIso) {
    return "";
  }
  const sec = Math.max(0, Math.floor((Date.now() - new Date(startedAtIso).getTime()) / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m} 分 ${s} 秒` : `${s} 秒`;
}

export function JobPoll({ jobId }: JobPollProps): ReactElement {
  const [job, setJob] = useState<JobPayload | null>(null);
  const [files, setFiles] = useState<JobFile[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        const data: unknown = await res.json();
        if (!res.ok) {
          let msg = `加载失败（${res.status}）`;
          if (data !== null && typeof data === "object" && "error" in data) {
            const errBody = (data as { error: unknown }).error;
            if (errBody !== null && typeof errBody === "object" && "message" in errBody) {
              const m = (errBody as { message: unknown }).message;
              if (typeof m === "string") {
                msg = m;
              }
            }
          }
          if (!cancelled) setErr(msg);
          return;
        }
        if (
          data !== null &&
          typeof data === "object" &&
          "job" in data &&
          "files" in data
        ) {
          const j = (data as { job: JobPayload; files: JobFile[] }).job;
          const f = (data as { job: JobPayload; files: JobFile[] }).files;
          if (!cancelled) {
            setJob(j);
            setFiles(f);
            setErr(null);
          }
        }
      } catch {
        if (!cancelled) setErr("网络错误");
      }
    }

    void load();
    const t = setInterval(() => void load(), 2000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [jobId]);

  useEffect(() => {
    if (!job || terminal.has(job.status)) {
      return;
    }
    const i = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(i);
  }, [job?.status, job]);

  if (err) {
    return <p className="text-sm text-destructive">{err}</p>;
  }

  if (!job) {
    return <p className="text-sm text-muted-foreground">加载任务…</p>;
  }

  const isDone = terminal.has(job.status);
  const runningFile = files.find((f) => f.status === "running");
  const elapsed = !isDone && job.startedAt ? formatElapsedMs(job.startedAt, tick) : "";

  return (
    <div className="space-y-6">
      <div className="space-y-1 text-sm">
        <p>
          仓库 <span className="font-mono">{job.repository.fullName}</span>（默认分支{" "}
          <span className="font-mono">{job.repository.defaultBranch}</span>）
        </p>
        <p>
          状态：<span className="font-medium">{job.status}</span>
          {!isDone ? <span className="ml-2 text-muted-foreground">（每 2 秒刷新列表）</span> : null}
        </p>
        {job.status === "running" && job.startedAt ? (
          <p className="text-muted-foreground">
            本阶段已运行：<span className="font-medium text-foreground">{elapsed}</span>
            {runningFile ? (
              <>
                {" "}
                · 当前文件：<span className="font-mono text-foreground">{runningFile.path}</span> →{" "}
                <span className="font-mono text-foreground">{runningFile.translatedPath}</span>
              </>
            ) : (
              " · 正在准备或更新队列…"
            )}
          </p>
        ) : null}
        {job.status === "pending" ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            等待 Worker：本机执行{" "}
            <code className="rounded bg-muted px-1">POST /api/worker/tick</code> 并带头{" "}
            <code className="rounded bg-muted px-1">x-cron-secret</code>
            ；生产环境见{" "}
            <code className="rounded bg-muted px-1">.github/workflows/worker-tick.yml</code>。
          </p>
        ) : null}
        <p className="text-muted-foreground">
          进度 {job.doneFiles}/{job.totalFiles}
          {job.failedFiles > 0 ? ` · 失败 ${job.failedFiles}` : null}
        </p>
        <p className="text-xs text-muted-foreground">
          任务首选模型：<span className="font-mono text-foreground">{job.modelId}</span>
          （各文件「实际使用」以下表为准，含自动降级）
        </p>
        {job.errorMessage ? (
          <p className="text-destructive whitespace-pre-wrap">{job.errorMessage}</p>
        ) : null}
        {job.prUrl ? (
          <p>
            <a
              href={job.prUrl}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline underline-offset-4"
            >
              在 GitHub 打开 PR（可审阅全部译文 diff）
            </a>
          </p>
        ) : isDone ? null : (
          <p className="text-xs text-muted-foreground">
            任务结束后会在此显示 PR 链接；单文件成功写入后也可点下表「译文」在分支上查看。
          </p>
        )}
      </div>

      <details className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
        <summary className="cursor-pointer font-medium text-foreground">各状态是什么意思？</summary>
        <ul className="mt-2 list-inside list-disc space-y-1 text-muted-foreground">
          <li>
            <strong className="text-foreground">queued</strong>：排队中。
          </li>
          <li>
            <strong className="text-foreground">running</strong>：正在拉原文 / 调模型 / 校验，大文档可能需数分钟。
          </li>
          <li>
            <strong className="text-foreground">succeeded</strong>：本文件译文已生成；合并进仓库需等 PR 合并。
          </li>
          <li>
            <strong className="text-foreground">failed</strong>：本文件失败，红色文字为模型或校验返回的原因。
          </li>
          <li>
            <strong className="text-foreground">skipped</strong>：跳过；常见{" "}
            <code className="rounded bg-muted px-1">hash-match</code> 表示内容与已成功翻译版本相同。
          </li>
        </ul>
      </details>

      <div className="space-y-2">
        <h2 className="text-sm font-medium">文件</h2>
        <ul className="max-h-96 space-y-2 overflow-y-auto rounded-md border border-border p-2 text-xs">
          {files.map((f) => (
            <li key={f.id} className="border-b border-border/40 pb-2 last:border-0">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 font-mono">
                <span>{f.path}</span>
                <span className="text-muted-foreground">→ {f.translatedPath}</span>
                <span className="text-muted-foreground">({f.lang})</span>
                <span className="font-sans font-medium">{f.status}</span>
              </div>
              <p className="mt-0.5 font-sans text-[11px] text-muted-foreground">
                {STATUS_HINT[f.status] ?? ""}
                {f.skipReason ? (
                  <>
                    {" "}
                    <span className="text-amber-700 dark:text-amber-500">
                      [{f.skipReason}] {SKIP_REASON_HINT[f.skipReason] ?? ""}
                    </span>
                  </>
                ) : null}
              </p>
              {f.errorMessage ? (
                <p className="mt-1 font-sans text-destructive whitespace-pre-wrap">{f.errorMessage}</p>
              ) : null}
              <div className="mt-1 flex flex-wrap gap-3 font-sans text-[11px]">
                <a
                  href={f.sourceViewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline underline-offset-2"
                >
                  查看原文（默认分支）
                </a>
                {f.translatedViewUrl ? (
                  <a
                    href={f.translatedViewUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline underline-offset-2"
                  >
                    查看译文（PR 分支）
                  </a>
                ) : f.status === "succeeded" && !job.branchName ? (
                  <span className="text-muted-foreground">译文：PR 创建后可点此处</span>
                ) : f.status === "skipped" ? (
                  <span className="text-muted-foreground">本 PR 未包含此文件（跳过）</span>
                ) : f.status === "failed" ? (
                  <span className="text-muted-foreground">未生成译文文件</span>
                ) : null}
              </div>
              {f.modelUsed ? (
                <p className="mt-0.5 font-sans text-[11px] text-muted-foreground">
                  实际模型：<span className="font-mono text-foreground">{f.modelUsed}</span>
                </p>
              ) : null}
              {f.durationMs > 0 || f.tokensOut > 0 ? (
                <p className="mt-0.5 font-sans text-[11px] text-muted-foreground">
                  {f.durationMs > 0 ? `耗时 ${Math.round(f.durationMs / 1000)}s` : null}
                  {f.tokensOut > 0
                    ? `${f.durationMs > 0 ? " · " : ""}tokens ${f.tokensIn}/${f.tokensOut}`
                    : null}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </div>

      <Link href="/dashboard" className={cn(buttonVariants({ variant: "outline" }))}>
        返回工作台
      </Link>
    </div>
  );
}
