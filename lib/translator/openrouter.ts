import "server-only";

import { env } from "@/lib/env";

type ChatResponse = {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type TranslateResult = {
  text: string;
  tokensIn: number;
  tokensOut: number;
  modelUsed: string;
};

/**
 * 调用 OpenRouter Chat Completions；429 时指数退避，主模型失败则换备用模型。
 */
export async function translateWithOpenRouter(
  systemPrompt: string,
  userContent: string,
  preferredModelId?: string,
): Promise<TranslateResult> {
  const raw = [
    preferredModelId?.trim(),
    env.TRANSLATION_MODEL_PRIMARY,
    env.TRANSLATION_MODEL_FALLBACK,
  ].filter((m): m is string => typeof m === "string" && m.length > 0);
  const models = [...new Set(raw)];

  let lastErr: Error | null = null;
  for (const model of models) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`${env.OPENROUTER_BASE_URL}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
            "HTTP-Referer": env.NEXT_PUBLIC_APP_URL,
            "X-Title": "GitHub Global",
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userContent },
            ],
            temperature: 0.2,
          }),
        });

        let body: unknown;
        try {
          body = await res.json();
        } catch {
          body = null;
        }
        const raw = body as ChatResponse;
        if (!res.ok) {
          const apiMsg =
            raw?.error !== null && typeof raw?.error === "object" && "message" in raw.error
              ? String((raw.error as { message: unknown }).message)
              : "";
          const msg = [apiMsg || res.statusText || `HTTP ${res.status}`, `模型 ${model}`]
            .filter(Boolean)
            .join(" · ");
          if (res.status === 429 && attempt < 2) {
            await sleep(1000 * 3 ** attempt);
            continue;
          }
          throw new Error(msg);
        }

        const text = raw.choices?.[0]?.message?.content?.trim() ?? "";
        if (!text) {
          throw new Error("Empty model response");
        }

        return {
          text,
          tokensIn: raw.usage?.prompt_tokens ?? 0,
          tokensOut: raw.usage?.completion_tokens ?? 0,
          modelUsed: model,
        };
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e));
        if (attempt < 2) {
          await sleep(1000 * 3 ** attempt);
        }
      }
    }
  }

  throw lastErr ?? new Error("OpenRouter failed");
}
