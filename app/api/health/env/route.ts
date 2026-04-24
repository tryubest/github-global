import { NextResponse } from "next/server";

import { checkEnvConfiguration } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * 不返回任何密钥，仅说明 zod 是否通过。用于验证 Vercel 环境变量是否对 Runtime 可见。
 * GET 当前部署的 origin + 本接口路径即可在浏览器中查看。
 */
export function GET(): NextResponse {
  const c = checkEnvConfiguration();
  if (c.ok) {
    return NextResponse.json({
      ok: true,
      hasNextPublicAppUrl: Boolean(process.env.NEXT_PUBLIC_APP_URL),
    });
  }
  return NextResponse.json(
    { ok: false, issues: c.issues },
    { status: 503 },
  );
}
