import "server-only";

import { z } from "zod";

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    /** Neon 非池化；未设时回退为 DATABASE_URL（与 schema 不强制 directUrl 一致） */
    DATABASE_URL_UNPOOLED: z.string().min(1).optional(),

  GITHUB_APP_ID: z.coerce.number().int().positive(),
  GITHUB_APP_CLIENT_ID: z.string().min(1, "GITHUB_APP_CLIENT_ID is required"),
  GITHUB_APP_CLIENT_SECRET: z.string().min(1, "GITHUB_APP_CLIENT_SECRET is required"),
  GITHUB_APP_PRIVATE_KEY_BASE64: z
    .string()
    .min(1, "GITHUB_APP_PRIVATE_KEY_BASE64 is required"),
  GITHUB_APP_WEBHOOK_SECRET: z.string().min(1, "GITHUB_APP_WEBHOOK_SECRET is required"),

  OPENROUTER_API_KEY: z.string().min(1, "OPENROUTER_API_KEY is required"),
  OPENROUTER_BASE_URL: z.url().default("https://openrouter.ai/api/v1"),
  TRANSLATION_MODEL_PRIMARY: z.string().min(1, "TRANSLATION_MODEL_PRIMARY is required"),
  TRANSLATION_MODEL_FALLBACK: z.string().min(1, "TRANSLATION_MODEL_FALLBACK is required"),

  ENCRYPTION_KEY: z.string().min(1, "ENCRYPTION_KEY is required"),
  SESSION_SECRET: z.string().min(1, "SESSION_SECRET is required"),
  CRON_SECRET: z.string().min(1, "CRON_SECRET is required"),

  NEXT_PUBLIC_APP_URL: z.url(),
  })
  .transform((d) => ({
    ...d,
    DATABASE_URL_UNPOOLED: d.DATABASE_URL_UNPOOLED ?? d.DATABASE_URL,
  }));

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const fields = Object.entries(parsed.error.flatten().fieldErrors)
    .map(([key, messages]) => `${key}: ${messages?.join(", ")}`)
    .join("\n");

  throw new Error(`Invalid environment variables:\n${fields}`);
}

export const env = parsed.data;

export type Env = typeof env;
