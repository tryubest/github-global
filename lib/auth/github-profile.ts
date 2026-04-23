import "server-only";

import { z } from "zod";

const userSchema = z.object({
  id: z.number().int().positive(),
  login: z.string().min(1),
  name: z.union([z.string(), z.null()]).optional(),
  email: z.union([z.string().email(), z.null()]).optional(),
  avatar_url: z.union([z.string().url(), z.null()]).optional(),
});

const emailItemSchema = z.object({
  email: z.string().email(),
  primary: z.boolean().optional(),
  visibility: z.string().nullable().optional(),
  verified: z.boolean().optional(),
});

export type GitHubUserProfile = {
  githubId: number;
  login: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
};

export async function fetchPrimaryEmail(args: { accessToken: string }): Promise<string | null> {
  const res = await fetch("https://api.github.com/user/emails", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${args.accessToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`GitHub user emails failed: ${res.status} ${t}`);
  }
  const raw: unknown = await res.json();
  const items = z.array(emailItemSchema).parse(raw);
  const primary = items.find((e) => e.primary);
  return primary?.email ?? items[0]?.email ?? null;
}

export async function fetchGitHubUserProfile(args: { accessToken: string }): Promise<GitHubUserProfile> {
  const res = await fetch("https://api.github.com/user", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${args.accessToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`GitHub /user failed: ${res.status} ${t}`);
  }
  const raw: unknown = await res.json();
  const u = userSchema.parse(raw);
  let email: string | null = u.email ?? null;
  if (!email) {
    try {
      email = await fetchPrimaryEmail(args);
    } catch {
      email = null;
    }
  }
  return {
    githubId: u.id,
    login: u.login,
    name: u.name ?? null,
    email,
    avatarUrl: u.avatar_url ?? null,
  };
}
