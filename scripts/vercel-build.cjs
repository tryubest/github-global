/**
 * Vercel：`prisma` / migrate 会读本进程的 `env`；Neon/集成常注入 POSTGRES_PRISMA_URL 等别名字段。
 * 本机构建时加载 .env / .env.local；Vercel 仓库内通常无此文件，仅用平台环境变量。
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

function nonempty(v) {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * 优先 pooled；否则用与 Neon 非池化 / Vercel Postgres 等兼容的一串别名字段（顺序重要）。
 * @param {NodeJS.ProcessEnv} e
 * @returns {string | null}
 */
function pickDatabaseUrl(e) {
  const candidates = [
    e.DATABASE_URL,
    e.DATABASE_URL_UNPOOLED,
    e.POSTGRES_PRISMA_URL,
    e.POSTGRES_URL,
    e.POSTGRES_URL_NON_POOLED,
    e.NEON_DATABASE_URL,
  ];
  for (const c of candidates) {
    if (nonempty(c)) return c.trim();
  }
  for (const [k, v] of Object.entries(e)) {
    if (!nonempty(v)) continue;
    if (!/DATABASE|POSTGRES|NEON/i.test(k)) continue;
    if (!/URL|URI|DSN|CONNECTION|PRISMA/i.test(k)) continue;
    return v.trim();
  }
  return null;
}

const dbUrl = pickDatabaseUrl(env);
if (!dbUrl) {
  const keys = [
    "DATABASE_URL",
    "DATABASE_URL_UNPOOLED",
    "POSTGRES_PRISMA_URL",
    "POSTGRES_URL",
    "POSTGRES_URL_NON_POOLED",
  ];
  const present = keys.map((k) => `${k}=${nonempty(env[k]) ? "set" : "missing"}`).join(" ");
  const hinted = Object.keys(env).filter(
    (k) =>
      /DATABASE|POSTGRES|NEON|PRISMA|SUPABASE/i.test(k) &&
      /URL|URI|DSN|CONNECTION/i.test(k),
  );
  console.error(
    [
      "[vercel-build] 未找到可用数据库连接串。",
      `诊断(仅 key 名，无密码): ${present}。`,
      hinted.length
        ? `构建进程里可见的「疑似数据库」变量名(无值): ${hinted.join(", ")}。`
        : "构建进程里没有任何匹配的 URL 类变量名（常见于：变量只勾了错误环境、或填在别的 Vercel 项目里）。",
      "若你已在 Vercel 里填写：① 点「Save」并确认保存成功 ② 变量须勾选本部署对应的环境（Production / Preview 与本次部署一致）③ 检查同名重复项与黄叹号 ④ Redeploy ⑤ Neon 集成若只注入 Runtime，请再手动添加同名变量供 Build 使用。",
    ].join(" "),
  );
  process.exit(1);
}
env.DATABASE_URL = dbUrl;

// Prisma schema 的 directUrl：migrate 需要；Neon+Vercel 集成常用 POSTGRES_URL_NON_POOLED
if (!nonempty(env.DATABASE_URL_UNPOOLED)) {
  const fallback =
    env.POSTGRES_URL_NON_POOLED ||
    env.POSTGRES_URL ||
    env.NEON_DATABASE_URL_UNPOOLED ||
    "";
  if (nonempty(fallback)) {
    env.DATABASE_URL_UNPOOLED = fallback.trim();
  }
}

function run(cmd) {
  console.log("> " + cmd);
  execSync(cmd, { stdio: "inherit", env, shell: true });
}

run("pnpm exec prisma migrate deploy");
run("pnpm exec prisma generate");
run("pnpm exec next build");
