import { NextResponse } from "next/server";

import { requireSession } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const auth = await requireSession();
  if (!auth.ok) {
    return auth.response;
  }
  const u = auth.data.user;
  return NextResponse.json({
    user: {
      id: u.id,
      githubId: u.githubId,
      login: u.login,
      name: u.name,
      email: u.email,
      avatarUrl: u.avatarUrl,
      createdAt: u.createdAt.toISOString(),
    },
  });
}
