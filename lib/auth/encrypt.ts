import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

import { env } from "@/lib/env";

let cachedKey: Buffer | undefined;

function getAesKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = env.ENCRYPTION_KEY;
  const b64 = raw.startsWith("base64:") ? raw.slice(7) : raw;
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY must decode to 32 bytes (AES-256)");
  }
  cachedKey = key;
  return key;
}

/** AES-256-GCM; output is base64url(iv || tag || ciphertext). */
export function encryptSecret(plain: string): string {
  const key = getAesKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64url");
}

export function decryptSecret(payload: string): string {
  const key = getAesKey();
  const buf = Buffer.from(payload, "base64url");
  if (buf.length < 12 + 16) {
    throw new Error("invalid encrypted payload");
  }
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
