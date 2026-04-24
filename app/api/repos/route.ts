import { NextResponse } from "next/server";

import { requireSession } from "@/lib/auth/guards";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const auth = await requireSession();
  if (!auth.ok) {
    return auth.response;
  }

  const { searchParams } = new URL(request.url);
  const installationId = searchParams.get("installationId") ?? undefined;
  const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
  const size = Math.min(50, Math.max(1, Number(searchParams.get("size") ?? "20")));
  const skip = (page - 1) * size;

  const where = {
    installation: {
      userId: auth.data.userId,
      ...(installationId ? { id: installationId } : {}),
    },
  };

  const [items, total] = await Promise.all([
    db.repository.findMany({
      where,
      orderBy: { fullName: "asc" },
      skip,
      take: size,
      select: {
        id: true,
        githubRepoId: true,
        fullName: true,
        defaultBranch: true,
        private: true,
        isEnabled: true,
        updatedAt: true,
        installation: {
          select: { id: true, accountLogin: true, githubInstallationId: true },
        },
      },
    }),
    db.repository.count({ where }),
  ]);

  return NextResponse.json({
    items: items.map((r) => ({
      id: r.id,
      githubRepoId: r.githubRepoId,
      fullName: r.fullName,
      defaultBranch: r.defaultBranch,
      private: r.private,
      isEnabled: r.isEnabled,
      updatedAt: r.updatedAt.toISOString(),
      installation: r.installation,
    })),
    page,
    size,
    total,
  });
}
