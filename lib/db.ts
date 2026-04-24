import "server-only";

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

const nodeEnv = process.env.NODE_ENV;

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log: nodeEnv === "development" ? ["warn", "error"] : ["error"],
  });
}

export const db = globalForPrisma.prisma ?? createPrismaClient();

if (nodeEnv !== "production") {
  globalForPrisma.prisma = db;
}
