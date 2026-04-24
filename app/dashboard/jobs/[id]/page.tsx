import { redirect } from "next/navigation";
import type { ReactElement } from "react";

import { getSessionForRequest } from "@/lib/auth/session";

import { JobPoll } from "./job-poll";

type PageProps = { params: Promise<{ id: string }> };

export default async function JobDetailPage({ params }: PageProps): Promise<ReactElement> {
  const session = await getSessionForRequest();
  if (!session) {
    redirect("/login");
  }

  const { id } = await params;

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col gap-6 px-4 py-16">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">翻译任务</h1>
        <p className="font-mono text-xs text-muted-foreground">{id}</p>
      </div>
      <JobPoll jobId={id} />
    </div>
  );
}
