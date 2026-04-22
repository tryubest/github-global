import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function LoginPage() {
  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col justify-center gap-8 px-4 py-16">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          登录
        </h1>
        <p className="text-sm text-muted-foreground">
          GitHub OAuth 尚未接入。M1 将在此页完成真实授权跳转。
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <button
          type="button"
          disabled
          className={cn(
            buttonVariants({ size: "lg" }),
            "cursor-not-allowed opacity-60",
          )}
        >
          使用 GitHub 登录（即将开放）
        </button>

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
