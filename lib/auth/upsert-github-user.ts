import "server-only";

import { db } from "@/lib/db";
import { encryptSecret } from "@/lib/auth/encrypt";
import { fetchGitHubUserProfile } from "@/lib/auth/github-profile";

import type { User } from "@prisma/client";

export async function upsertUserFromOAuth(args: { accessToken: string }): Promise<User> {
  const profile = await fetchGitHubUserProfile(args);
  const accessTokenEnc = encryptSecret(args.accessToken);
  return db.user.upsert({
    where: { githubId: profile.githubId },
    create: {
      githubId: profile.githubId,
      login: profile.login,
      name: profile.name,
      email: profile.email,
      avatarUrl: profile.avatarUrl,
      accessTokenEnc,
    },
    update: {
      login: profile.login,
      name: profile.name,
      email: profile.email,
      avatarUrl: profile.avatarUrl,
      accessTokenEnc,
    },
  });
}
