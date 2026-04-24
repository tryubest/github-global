"use client";

import { useState, type ReactElement } from "react";

import { buttonVariants } from "@/components/ui/button";
import { JOB_TARGET_LANG_LABELS, JOB_TARGET_LANGS, type JobTargetLang } from "@/lib/jobs/target-langs";
import { cn } from "@/lib/utils";

type StartTranslationButtonProps = {
  repositoryId: string;
  className?: string;
};

export function StartTranslationButton({
  repositoryId,
  className,
}: StartTranslationButtonProps): ReactElement {
  const [loading, setLoading] = useState(false);
  const [targetLang, setTargetLang] = useState<JobTargetLang>("en");

  async function onSubmit(): Promise<void> {
    setLoading(true);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repositoryId,
          targetLangs: [targetLang],
        }),
      });
      const data: unknown = await res.json();
      if (!res.ok) {
        const msg =
          data !== null &&
          typeof data === "object" &&
          "error" in data &&
          data.error !== null &&
          typeof data.error === "object" &&
          "message" in data.error &&
          typeof (data.error as { message: unknown }).message === "string"
            ? (data.error as { message: string }).message
            : `请求失败（${res.status}）`;
        window.alert(msg);
        setLoading(false);
        return;
      }
      if (
        data !== null &&
        typeof data === "object" &&
        "jobId" in data &&
        typeof (data as { jobId: unknown }).jobId === "string"
      ) {
        window.location.href = `/dashboard/jobs/${(data as { jobId: string }).jobId}`;
        return;
      }
      window.alert("响应格式异常");
    } catch {
      window.alert("网络错误");
    } finally {
      setLoading(false);
    }
  }

  return (
    <span className={cn("flex flex-wrap items-center gap-2", className)}>
      <label className="sr-only" htmlFor={`target-lang-${repositoryId}`}>
        目标语言
      </label>
      <select
        id={`target-lang-${repositoryId}`}
        className="h-8 max-w-[11rem] rounded-md border border-input bg-background px-2 text-xs"
        value={targetLang}
        disabled={loading}
        onChange={(e) => setTargetLang(e.target.value as JobTargetLang)}
      >
        {JOB_TARGET_LANGS.map((code) => (
          <option key={code} value={code}>
            {JOB_TARGET_LANG_LABELS[code]}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={loading}
        onClick={() => void onSubmit()}
        className={cn(buttonVariants({ size: "sm" }))}
      >
        {loading ? "创建中…" : "开始翻译"}
      </button>
    </span>
  );
}
