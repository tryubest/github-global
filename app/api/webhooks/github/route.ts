import { Webhooks } from "@octokit/webhooks";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { isPrismaUniqueViolation, runWebhookSideEffects } from "@/lib/webhooks/process-github-payload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request): Promise<NextResponse> {
  const raw = await request.text();
  const deliveryId = request.headers.get("x-github-delivery");
  const eventName = request.headers.get("x-github-event");
  const signature = request.headers.get("x-hub-signature-256");

  if (!deliveryId || !eventName || !signature) {
    return new NextResponse("missing headers", { status: 400 });
  }

  const webhooks = new Webhooks({ secret: env.GITHUB_APP_WEBHOOK_SECRET });
  const valid = await webhooks.verify(raw, signature);
  if (!valid) {
    return new NextResponse("invalid signature", { status: 401 });
  }

  let json: unknown;
  try {
    json = JSON.parse(raw) as unknown;
  } catch {
    return new NextResponse("invalid json", { status: 400 });
  }

  let created;
  try {
    created = await db.webhookEvent.create({
      data: {
        deliveryId,
        eventType: eventName,
        payload: json as object,
      },
    });
  } catch (e) {
    if (isPrismaUniqueViolation(e)) {
      return new NextResponse(null, { status: 200 });
    }
    throw e;
  }

  await runWebhookSideEffects({
    webhookEventId: created.id,
    eventName,
    payload: json,
  });

  return new NextResponse(null, { status: 200 });
}
