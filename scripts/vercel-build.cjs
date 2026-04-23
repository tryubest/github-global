/**
 * Vercel 上 `prisma` CLI 只读 `process.env`；部分 Neon 集成只注入 POSTGRES_PRISMA_URL 等。
 * 在跑 migrate 前将常用别名写回 DATABASE_URL，便于与 lib/env 及 schema 一致。
 * 本机构建时加载 .env / .env.local（与 Prisma CLI 行为一致）；Vercel 无这些文件时仅用平台环境变量。
 */
const path = require("node:path");
const fs = require("node:fs");
const { execSync } = require("node:child_process");

const root = process.cwd();
const envPath = path.join(root, ".env");
const localPath = path.join(root, ".env.local");
if (fs.existsSync(envPath)) {
  require("dotenv").config({ path: envPath });
}
if (fs.existsSync(localPath)) {
  require("dotenv").config({ path: localPath, override: true });
}

const env = { ...process.env };
if (!env.DATABASE_URL) {
  env.DATABASE_URL =
    env.POSTGRES_PRISMA_URL ||
    env.POSTGRES_URL ||
    env.NEON_DATABASE_URL ||
    env.DATABASE_URL_UNPOOLED ||
    "";
}
if (!env.DATABASE_URL) {
  console.error(
    [
      "[vercel-build] 未找到 DATABASE_URL。",
      "请在 Vercel → 项目 → Settings → Environment Variables 中，为 Production 添加 DATABASE_URL（Neon 连接串），",
      "或确保 Neon/Vercel 集成已注入 POSTGRES_PRISMA_URL 等。",
    ].join(""),
  );
  process.exit(1);
}

function run(cmd) {
  console.log("> " + cmd);
  execSync(cmd, { stdio: "inherit", env, shell: true });
}

run("pnpm exec prisma migrate deploy");
run("pnpm exec prisma generate");
run("pnpm exec next build");
