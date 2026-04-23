import Link from "next/link";
import type { ReactElement } from "react";

import { buttonVariants } from "@/components/ui/button";
import { getSessionForRequest } from "@/lib/auth/session";
import { cn } from "@/lib/utils";

export default async function DashboardPage(): Promise<ReactElement> {
  const session = await getSessionForRequest();
  const display = session?.user.login ?? "开发者";

  return (
    <div className="mx-auto flex min-h-full max-w-lg flex-col gap-8 px-4 py-16">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">工作台</h1>
        <p className="text-sm text-muted-foreground">
          已登录为 <span className="font-medium text-foreground">{display}</span>
          。后续 M1 将在此接入安装 App 与仓库列表。
        </p>
      </div>
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
