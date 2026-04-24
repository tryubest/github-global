import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactElement } from "react";

import { StartTranslationButton } from "@/components/dashboard/start-translation-button";
import { buttonVariants } from "@/components/ui/button";
import { getSessionForRequest } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { cn } from "@/lib/utils";

type DashboardPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function DashboardPage({
  searchParams,
}: DashboardPageProps): Promise<ReactElement> {
  const sp = searchParams ? await searchParams : {};
  const rawSync = sp.sync;
  const syncOk = rawSync === "ok" || (Array.isArray(rawSync) && rawSync[0] === "ok");
  const syncErr = rawSync === "err" || (Array.isArray(rawSync) && rawSync[0] === "err");
  const syncReasonRaw = sp.reason;
  const syncReasonStr = Array.isArray(syncReasonRaw) ? syncReasonRaw[0] : syncReasonRaw;
  const pullRaw = sp.pull;
  const pullStatus = Array.isArray(pullRaw) ? pullRaw[0] : pullRaw;
  const pullOk = pullStatus === "ok";
  const pullErr = pullStatus === "err";
  const installCountStr = Array.isArray(sp.installs) ? sp.installs[0] : sp.installs;
  const repoCountStr = Array.isArray(sp.repos) ? sp.repos[0] : sp.repos;
  const reasonStr = Array.isArray(sp.reason) ? sp.reason[0] : sp.reason;
  const session = await getSessionForRequest();
  if (!session) {
    redirect("/login");
  }

  const display = session.user.login;
  const [installations, repos] = await Promise.all([
    db.installation.findMany({
      where: { userId: session.userId },
      orderBy: { accountLogin: "asc" },
      select: { id: true, accountLogin: true, accountType: true, suspendedAt: true },
    }),
    db.repository.findMany({
      where: { installation: { userId: session.userId } },
      orderBy: { fullName: "asc" },
      take: 100,
      select: {
        id: true,
        fullName: true,
        private: true,
        isEnabled: true,
        defaultBranch: true,
        installation: { select: { accountLogin: true } },
      },
    }),
  ]);

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col gap-8 px-4 py-16">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">工作台</h1>
        {syncOk ? (
          <p className="text-sm text-green-600 dark:text-green-500">全量同步已完成。</p>
        ) : null}
        {syncErr ? (
          <p className="text-sm text-destructive">
            全量同步失败。{syncReasonStr ? <span className="block mt-1 whitespace-pre-wrap">{syncReasonStr}</span> : null}
          </p>
        ) : null}
        {pullOk ? (
          <p className="text-sm text-green-600 dark:text-green-500">
            已从 GitHub 拉取安装与仓库
            {installCountStr != null && repoCountStr != null
              ? `（安装 ${installCountStr} 个、写入仓库行 ${repoCountStr} 条）。`
              : "。"}
            {Number(installCountStr) === 0 && (
              <span className="ml-1 block text-amber-700 dark:text-amber-500">
                未匹配到本 App 的安装。请确认 `.env` 里 `GITHUB_APP_ID` 与当前 GitHub App 设置中的 App
                ID 一致（即你正在使用的那一个 App）。
              </span>
            )}
          </p>
        ) : null}
        {pullErr ? (
          <p className="text-sm text-destructive">
            从 GitHub 拉取安装失败。{reasonStr ? `（${reasonStr}）` : ""}
            可尝试重新登录，或检查网络与权限。
          </p>
        ) : null}
        <p className="text-sm text-muted-foreground">
          <strong className="text-foreground">创建翻译任务：</strong>
          在「已授权仓库」中选目标语言后点「开始翻译」（例如中文文档选 English）；任务创建后需在任务页触发 Worker（本机 curl 或 GitHub
          Actions）。若列表为空，请先「全量同步」或「从 GitHub 拉取安装与仓库」。
        </p>
        <p className="text-sm text-muted-foreground">
          已登录为 <span className="font-medium text-foreground">{display}</span>
          。生产环境在 GitHub 里配置好 Webhook URL 后，安装事件会推送到服务器并自动写入。你在{" "}
          <strong>本机 http://127.0.0.1:3000</strong> 时，GitHub 无法把 Webhook 送到本地，所以下方列表常常为空
          <span className="whitespace-nowrap">——</span>请点击「从 GitHub 拉取安装与仓库」用已登录的 OAuth
          令牌去补全（与线上一致的数据库/`.env` 时即可看到你在 GitHub 上已安装的本 App）。
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-foreground">安装实例</h2>
        {installations.length === 0 ? (
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              这里尚未有安装记录。若你已在 GitHub 侧安装过本 App，在本地请用下面按钮从 GitHub
              拉取（不依赖 Webhook）：
            </p>
            <form action="/api/installations/pull" method="post" className="inline-block">
              <button type="submit" className={cn(buttonVariants())}>
                从 GitHub 拉取安装与仓库
              </button>
            </form>
            <p className="text-xs leading-relaxed text-muted-foreground/90">
              仅当你从未在本地登录过、或想刷新列表时再点；拉取会按你当前账号的 OAuth 权限，匹配{" "}
              <code className="rounded bg-muted px-1">GITHUB_APP_ID</code> 对应的安装并写入数据库。
            </p>
          </div>
        ) : (
          <ul className="space-y-2 text-sm">
            {installations.map((i) => (
              <li
                key={i.id}
                className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border border-border px-3 py-2"
              >
                <span className="font-medium">
                  {i.accountLogin}{" "}
                  <span className="font-normal text-muted-foreground">({i.accountType})</span>
                </span>
                {i.suspendedAt ? (
                  <span className="text-amber-600">已暂停</span>
                ) : (
                  <span className="text-muted-foreground">正常</span>
                )}
                <form action="/api/repos/sync" method="post" className="w-full sm:w-auto">
                  <input type="hidden" name="installationId" value={i.id} />
                  <button
                    type="submit"
                    className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
                  >
                    全量同步
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-foreground">已授权仓库</h2>
        {repos.length === 0 ? (
          <p className="text-sm text-muted-foreground">本地尚无仓库行；完成安装并同步后会出现列表。</p>
        ) : (
          <ul className="max-h-80 space-y-1.5 overflow-y-auto rounded-md border border-border p-2 text-sm">
            {repos.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 py-1.5 last:border-0"
              >
                <span className="font-mono text-xs sm:text-sm">{r.fullName}</span>
                <span className="flex shrink-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {r.private ? "私有" : "公开"} · {r.installation.accountLogin}
                  {!r.private ? <StartTranslationButton repositoryId={r.id} /> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="flex flex-wrap gap-3">
        <form action="/api/auth/logout" method="post">
          <button type="submit" className={cn(buttonVariants({ variant: "outline" }))}>
            退出登录
          </button>
        </form>
        <Link href="/" className={buttonVariants({ variant: "ghost" })}>
          返回首页
        </Link>
      </div>
    </div>
  );
}
