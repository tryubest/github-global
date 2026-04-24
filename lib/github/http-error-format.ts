import "server-only";

/** @octokit/request 抛出的 HTTP 错误形态（不依赖具体类名）。 */
export function isOctokitHttpError(e: unknown): e is { status: number; message: string } {
  return (
    e !== null &&
    typeof e === "object" &&
    "status" in e &&
    typeof (e as { status: unknown }).status === "number" &&
    "message" in e &&
    typeof (e as { message: unknown }).message === "string"
  );
}

function githubResponseMessage(e: unknown): string {
  if (e === null || typeof e !== "object") {
    return "";
  }
  const res = e as { response?: { data?: unknown } };
  const data = res.response?.data;
  if (data !== null && typeof data === "object" && "message" in data) {
    const m = (data as { message: unknown }).message;
    if (typeof m === "string" && m.trim()) {
      return m.trim();
    }
  }
  return "";
}

/**
 * 全量同步 / Webhook 补拉：使用 **Installation access token** 调用
 * `GET /installation/repositories` 等时的错误说明（勿与用户 OAuth 的 `/user/installations` 混用）。
 */
export function formatInstallationReposListError(e: unknown): { code: string; message: string } {
  if (isOctokitHttpError(e)) {
    const gh = githubResponseMessage(e);
    const detail = gh ? `（${gh}）` : e.message ? `（${e.message}）` : "";

    if (e.status === 401) {
      return {
        code: "GITHUB_UNAUTHORIZED",
        message:
          `安装令牌鉴权失败 ${detail}。请核对：GITHUB_APP_ID、GITHUB_APP_PRIVATE_KEY_BASE64（与当前 App 的 .pem 一致、Base64 单行无换行）、GITHUB_APP_CLIENT_ID / GITHUB_APP_CLIENT_SECRET 是否同属该 App。`,
      };
    }
    if (e.status === 403) {
      return {
        code: "GITHUB_FORBIDDEN",
        message:
          `安装实例无权列出可访问仓库 ${detail}。请到 GitHub → Settings → Developer settings → 你的 GitHub App → Permissions → Repository permissions，将 **Contents** 设为 **Read-only** 或 **Read and write**，点 Save；再打开 **Install App** → Configure，确认出现「接受新权限」并完成授权。仅改权限不重新接受时，旧安装令牌仍无效。`,
      };
    }
    return {
      code: "GITHUB_ERROR",
      message: gh || e.message || `GitHub 请求失败（HTTP ${e.status}）`,
    };
  }
  if (e instanceof Error) {
    return { code: "INTERNAL", message: e.message };
  }
  return { code: "INTERNAL", message: "未知错误" };
}
