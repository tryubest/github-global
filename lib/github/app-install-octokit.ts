import "server-only";

import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";

import { env } from "@/lib/env";

function stripOuterQuotes(s: string): string {
  const t = s.trim();
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) {
    return t.slice(1, -1).trim();
  }
  return t;
}

function looksLikePem(s: string): boolean {
  return (
    /-----BEGIN[A-Z0-9 -]+-----/.test(s) &&
    /-----END[A-Z0-9 -]+-----/.test(s) &&
    s.includes("PRIVATE KEY")
  );
}

/**
 * 支持：① 标准 Base64（单行或多行，会自动去掉空白）；② 误把整段 PEM 放进该变量（含 BEGIN/END）。
 * 解码后校验 PEM 形态，避免把垃圾字节交给 @octokit/auth-app 再得到 GitHub「JWT could not be decoded」。
 */
function privateKeyPemFromEnv(): string {
  let raw = stripOuterQuotes(env.GITHUB_APP_PRIVATE_KEY_BASE64);
  raw = raw.replace(/\\n/g, "\n");

  if (looksLikePem(raw)) {
    return raw;
  }

  const b64 = raw.replace(/\s/g, "");
  if (!b64.length) {
    throw new Error("GITHUB_APP_PRIVATE_KEY_BASE64 为空");
  }

  let pem: string;
  try {
    pem = Buffer.from(b64, "base64").toString("utf8");
  } catch {
    throw new Error("GITHUB_APP_PRIVATE_KEY_BASE64 无法按 Base64 解码");
  }

  if (!looksLikePem(pem)) {
    throw new Error(
      "GITHUB_APP_PRIVATE_KEY_BASE64 解码后不是 PEM 私钥。请用当前 GitHub App 下载的 .pem 重新生成 Base64（整文件、单行、无空格），或直接把整段 PEM（含 BEGIN/END）写入该变量。",
    );
  }

  return pem;
}

/**
 * 使用 Installation Token 调用 GitHub REST（例如列出可访问仓库）。
 */
export async function getOctokitForInstallation(
  githubInstallationId: number,
): Promise<Octokit> {
  const appAuth = createAppAuth({
    appId: env.GITHUB_APP_ID,
    privateKey: privateKeyPemFromEnv(),
    clientId: env.GITHUB_APP_CLIENT_ID,
    clientSecret: env.GITHUB_APP_CLIENT_SECRET,
  });
  const { token } = await appAuth({ type: "installation", installationId: githubInstallationId });
  return new Octokit({ auth: token });
}
