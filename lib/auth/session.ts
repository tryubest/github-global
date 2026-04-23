import "server-only";

import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { sha256Hex } from "@/lib/auth/hash";
import {
  OAUTH_NEXT_COOKIE,
  OAUTH_STATE_COOKIE,
  MS_PER_DAY,
  SESSION_COOKIE,
  SESSION_MAX_AGE_S,
} from "@/lib/auth/session-constants";

import type { User } from "@prisma/client";

const secureCookie = process.env.NODE_ENV === "production";

type SessionWithUser = {
  sessionId: string;
  userId: string;
  user: User;
  expiresAt: Date;
};

export function generateOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function appendSessionCookie(res: NextResponse, token: string): void {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
    secure: secureCookie,
  });
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    secure: secureCookie,
  });
}

export async function createSessionForUser(userId: string, res: NextResponse): Promise<string> {
  const token = generateOpaqueToken();
  const tokenHash = sha256Hex(token);
  const expiresAt = new Date(Date.now() + 7 * MS_PER_DAY);
  await db.session.create({ data: { userId, tokenHash, expiresAt } });
  appendSessionCookie(res, token);
  return token;
}

export async function getSessionForRequest(): Promise<SessionWithUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const tokenHash = sha256Hex(token);
  const row = await db.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) {
    await db.session.delete({ where: { id: row.id } });
    return null;
  }
  const nextExp = new Date(Date.now() + 7 * MS_PER_DAY);
  if (nextExp.getTime() - row.expiresAt.getTime() > 60_000) {
    await db.session.update({
      where: { id: row.id },
      data: { expiresAt: nextExp },
    });
  }
  return { sessionId: row.id, userId: row.userId, user: row.user, expiresAt: nextExp };
}

export async function deleteSessionByToken(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const tokenHash = sha256Hex(token);
    await db.session.deleteMany({ where: { tokenHash } });
  }
}

export function setOauthStateCookies(res: NextResponse, state: string, nextPath: string): void {
  const opts = {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 600,
    secure: secureCookie,
  };
  res.cookies.set(OAUTH_STATE_COOKIE, state, opts);
  res.cookies.set(OAUTH_NEXT_COOKIE, nextPath, opts);
}

export function clearOauthCookies(res: NextResponse): void {
  const z = { httpOnly: true, sameSite: "lax" as const, path: "/", maxAge: 0, secure: secureCookie };
  res.cookies.set(OAUTH_STATE_COOKIE, "", z);
  res.cookies.set(OAUTH_NEXT_COOKIE, "", z);
}

export function readOauthStateFromRequest(jar: Awaited<ReturnType<typeof cookies>>): {
  state: string;
  nextPath: string;
} | null {
  const s = jar.get(OAUTH_STATE_COOKIE)?.value;
  const n = jar.get(OAUTH_NEXT_COOKIE)?.value;
  if (!s || !n) return null;
  return { state: s, nextPath: n };
}

/**
 * 登录后重定向 path：仅在 callback 中信任此前由 start 写入的 cookie 值，且再次校验为站内路径。
 */
export function safePostLoginPathOrDefault(
  fromCookie: string,
  appOrigin: string,
  fallback: string,
): string {
  try {
    const u = new URL(fromCookie, appOrigin);
    if (u.origin !== new URL(appOrigin).origin) return fallback;
    if (!u.pathname.startsWith("/") || u.pathname.startsWith("//")) return fallback;
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return fallback;
  }
}
