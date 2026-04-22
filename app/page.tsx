import Link from "next/link";
import { Github } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function Home() {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4 sm:px-6">
          <span className="text-sm font-semibold tracking-tight text-foreground">
            GitHub Global
          </span>
          <Link
            href="/login"
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "gap-2",
            )}
          >
            <Github className="size-4" aria-hidden />
            登录
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center gap-8 px-4 py-16 sm:px-6">
        <div className="space-y-4">
          <p className="text-sm font-medium text-muted-foreground">
            M0 脚手架 · 纯静态页面
          </p>
          <h1 className="text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            让开源项目的文档，一次点击走向多语言
          </h1>
          <p className="max-w-2xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
            当前阶段仅展示布局与按钮样式，尚未接入 GitHub OAuth。点击下方按钮将跳转到占位登录页。
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Link
            href="/login"
            className={cn(buttonVariants({ size: "lg" }), "gap-2")}
          >
            <Github className="size-4" aria-hidden />
            使用 GitHub 登录
          </Link>
        </div>
      </main>
    </div>
  );
}
