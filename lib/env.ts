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

export type Env = z.infer<typeof envSchema>;

let cache: Env | null = null;

/**
 * 惰性校验：import `env` 不会在模块加载时抛错。首次读取任一字段时才解析 process.env。
 * 这样 `next build` 在未配置全部 Vercel 变量时，只要构建过程不真正访问到这些字段，即可通过；
 * 生产请求仍会在此处得到完整 zod 校验。
 */
function loadEnvOrThrow(): Env {
  if (cache) {
    return cache;
  }
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const fields = Object.entries(parsed.error.flatten().fieldErrors)
      .map(([key, messages]) => `${key}: ${messages?.join(", ")}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${fields}`);
  }
  cache = parsed.data;
  return cache;
}

export const env: Env = new Proxy({} as Env, {
  get(_target, prop: string | symbol) {
    return loadEnvOrThrow()[prop as keyof Env];
  },
  has() {
    return true;
  },
  ownKeys() {
    return Reflect.ownKeys(loadEnvOrThrow());
  },
  getOwnPropertyDescriptor(_target, prop) {
    const data = loadEnvOrThrow();
    if (Object.prototype.hasOwnProperty.call(data, prop)) {
      return {
        enumerable: true,
        configurable: true,
        value: (data as Record<string | number | symbol, unknown>)[prop],
      };
    }
    return undefined;
  },
}) as unknown as Env;
