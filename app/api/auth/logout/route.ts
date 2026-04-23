import { NextResponse } from "next/server";

import { clearSessionCookie, deleteSessionByToken } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  await deleteSessionByToken();
  const res = NextResponse.redirect(new URL("/login", request.url), 303);
  clearSessionCookie(res);
  return res;
}
