import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const ERROR_HINT: Record<string, string> = {
  invalid_state: "登录态已过期或不在同一浏览器完成，请关闭本页后从登录页重试。",
  missing_code: "未收到 GitHub 授权码，请重新登录。",
  token_exchange:
    "换取访问令牌失败：请确认 GitHub App 的 Callback URL 与 Vercel 中 NEXT_PUBLIC_APP_URL 完全一致，且含 https。",
  user_profile: "获取 GitHub 用户信息失败，请稍后重试。",
  session_db:
    "写入登录会话失败（常见为数据库连接/迁移）。请查看 Vercel Runtime Logs 与 Neon 是否允许当前部署区域访问。",
  callback: "回调处理出现未预期错误，请查看 Vercel Runtime Logs 中的堆栈。",
};

function hintForError(code: string | undefined): string | null {
  if (!code) return null;
  return ERROR_HINT[code] ?? `登录未成功（${code}），请重试或查看部署日志。`;
}

type PageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function LoginPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const errHint = hintForError(sp.error);

  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col justify-center gap-8 px-4 py-16">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          登录
        </h1>
        <p className="text-sm text-muted-foreground">
          使用 GitHub 账号授权登录，登录后可继续安装 App 并管理仓库。
        </p>
        {errHint && (
          <p
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-left text-sm text-destructive"
          >
            {errHint}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <a
          href="/api/auth/github/start?redirect=/dashboard"
          className={cn(buttonVariants({ size: "lg" }))}
        >
          使用 GitHub 登录
        </a>

        <Link
          href="/"
          className={cn(
            buttonVariants({ variant: "ghost", size: "default" }),
            "gap-2 self-center",
          )}
        >
          <ArrowLeft className="size-4" aria-hidden />
          返回首页
        </Link>
      </div>
    </div>
  );
}
