import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { env } from "@/lib/env";
import { jsonError } from "@/lib/api-error";
import { exchangeCodeForToken, getOAuthRedirectUrl } from "@/lib/auth/oauth";
import {
  clearOauthCookies,
  createSessionForUser,
  readOauthStateFromRequest,
  safePostLoginPathOrDefault,
} from "@/lib/auth/session";
import { upsertUserFromOAuth } from "@/lib/auth/upsert-github-user";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  const raw = {
    code: req.nextUrl.searchParams.get("code") ?? undefined,
    state: req.nextUrl.searchParams.get("state") ?? undefined,
    error: req.nextUrl.searchParams.get("error") ?? undefined,
    error_description: req.nextUrl.searchParams.get("error_description") ?? undefined,
  };
  const parsed = querySchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(422, "INVALID_QUERY", "回调参数无效");
  }
  const q = parsed.data;
  const appBase = env.NEXT_PUBLIC_APP_URL;
  const loginUrl = (suffix: string): URL => new URL(`/login${suffix}`, appBase);

  if (q.error) {
    const res = NextResponse.redirect(loginUrl(`?error=${encodeURIComponent(q.error)}`), 302);
    clearOauthCookies(res);
    return res;
  }
  if (!q.code || !q.state) {
    const res = NextResponse.redirect(loginUrl("?error=missing_code"), 302);
    clearOauthCookies(res);
    return res;
  }

  const jar = await cookies();
  const oauth = readOauthStateFromRequest(jar);
  if (!oauth || oauth.state !== q.state) {
    const res = NextResponse.redirect(loginUrl("?error=invalid_state"), 302);
    clearOauthCookies(res);
    return res;
  }

  const redirectUri = getOAuthRedirectUrl();
  let accessToken: string;
  try {
    accessToken = await exchangeCodeForToken({ code: q.code, redirectUri });
  } catch (e) {
    console.error("github oauth token exchange failed", { cause: e });
    const res = NextResponse.redirect(loginUrl("?error=token_exchange"), 302);
    clearOauthCookies(res);
    return res;
  }

  let user;
  try {
    user = await upsertUserFromOAuth({ accessToken });
  } catch (e) {
    console.error("github user upsert failed", { cause: e });
    const res = NextResponse.redirect(loginUrl("?error=user_profile"), 302);
    clearOauthCookies(res);
    return res;
  }

  const nextPath = safePostLoginPathOrDefault(oauth.nextPath, appBase, "/dashboard");
  const dest = new URL(nextPath, appBase);
  const res = NextResponse.redirect(dest, 302);
  clearOauthCookies(res);
  await createSessionForUser(user.id, res);
  return res;
}
