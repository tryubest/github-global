import "server-only";

import { env } from "@/lib/env";

const GITHUB_OAUTH = "https://github.com/login/oauth/authorize" as const;
const GITHUB_TOKEN = "https://github.com/login/oauth/access_token" as const;
const SCOPE = "read:user user:email" as const;

export function getOAuthRedirectUrl(): string {
  return new URL("/api/auth/github/callback", env.NEXT_PUBLIC_APP_URL).toString();
}

export function buildGitHubAuthorizeUrl(args: { state: string; redirectUri: string }): string {
  const u = new URL(GITHUB_OAUTH);
  u.searchParams.set("client_id", env.GITHUB_APP_CLIENT_ID);
  u.searchParams.set("state", args.state);
  u.searchParams.set("redirect_uri", args.redirectUri);
  u.searchParams.set("scope", SCOPE);
  return u.toString();
}

type TokenResponse = {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

export async function exchangeCodeForToken(args: { code: string; redirectUri: string }): Promise<string> {
  const res = await fetch(GITHUB_TOKEN, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: env.GITHUB_APP_CLIENT_ID,
      client_secret: env.GITHUB_APP_CLIENT_SECRET,
      code: args.code,
      redirect_uri: args.redirectUri,
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`GitHub token exchange failed: ${res.status} ${t}`);
  }

  const body = (await res.json()) as TokenResponse;
  if (body.error) {
    throw new Error(
      `GitHub token error: ${body.error}${body.error_description ? ` — ${body.error_description}` : ""}`,
    );
  }
  if (!body.access_token) {
    throw new Error("GitHub token response missing access_token");
  }
  return body.access_token;
}
