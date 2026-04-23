import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { env } from "@/lib/env";
import { buildGitHubAuthorizeUrl, getOAuthRedirectUrl } from "@/lib/auth/oauth";
import { generateOpaqueToken, setOauthStateCookies } from "@/lib/auth/session";
import { jsonError } from "@/lib/api-error";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  redirect: z.string().optional(),
});

function validateNextPath(input: string | undefined, origin: string): string {
  const fallback = "/dashboard";
  if (input === undefined || input === "") return fallback;
  if (!input.startsWith("/") || input.startsWith("//")) return fallback;
  try {
    const u = new URL(input, origin);
    if (u.origin !== new URL(origin).origin) return fallback;
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return fallback;
  }
}

export function GET(req: NextRequest): NextResponse {
  const parsed = querySchema.safeParse({
    redirect: req.nextUrl.searchParams.get("redirect") ?? undefined,
  });
  if (!parsed.success) {
    return jsonError(422, "INVALID_QUERY", "查询参数无效");
  }
  const origin = env.NEXT_PUBLIC_APP_URL;
  const nextPath = validateNextPath(parsed.data.redirect, origin);
  const state = generateOpaqueToken();
  const redirectUri = getOAuthRedirectUrl();
  const url = buildGitHubAuthorizeUrl({ state, redirectUri });
  const res = NextResponse.redirect(url, 302);
  setOauthStateCookies(res, state, nextPath);
  return res;
}
