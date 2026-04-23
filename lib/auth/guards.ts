import "server-only";

import { jsonError } from "@/lib/api-error";
import { getSessionForRequest } from "@/lib/auth/session";
import { NextResponse } from "next/server";

import type { User } from "@prisma/client";

export type Authed = {
  userId: string;
  user: User;
  sessionId: string;
};

export async function requireSession(): Promise<
  | { ok: true; data: Authed }
  | { ok: false; response: NextResponse }
> {
  const s = await getSessionForRequest();
  if (!s) {
    return { ok: false, response: jsonError(401, "UNAUTHORIZED", "需要登录") };
  }
  return {
    ok: true,
    data: { userId: s.userId, user: s.user, sessionId: s.sessionId },
  };
}
