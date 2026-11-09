import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import type { FactRepository } from "./service";

/** Postgres-backed repository. Every query is scoped by the caller's userId. */
export function createPrismaFactRepository(prisma: PrismaClient): FactRepository {
  return {
    async getFavoriteMovie(userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { favoriteMovie: true },
      });
      return user?.favoriteMovie ?? null;
    },

    findLatestFact(userId, movie) {
      // Served by the (userId, movie, createdAt DESC) index.
      return prisma.fact.findFirst({
        where: { userId, movie },
        orderBy: { createdAt: "desc" },
      });
    },

    createFact({ userId, movie, content, createdAt }) {
      return prisma.fact.create({ data: { userId, movie, content, createdAt } });
    },

    async tryAcquireLock(userId, now, leaseMs) {
      const token = randomUUID();
      const lockedUntil = new Date(now.getTime() + leaseMs);
      // Single atomic statement:
      //  - no row yet            -> INSERT succeeds, we own the lease
      //  - row with expired lease -> UPDATE takes it over, we own the lease
      //  - row with live lease    -> WHERE is false, nothing returned, we don't
      // Concurrent callers serialise on the row, so exactly one wins.
      // Timestamps are passed as UTC ISO strings cast to `timestamp`, matching
      // how Prisma stores DateTime (UTC, without time zone).
      const rows = await prisma.$queryRaw<{ token: string }[]>`
        INSERT INTO "FactGenerationLock" ("userId", "token", "lockedUntil")
        VALUES (${userId}, ${token}, ${lockedUntil.toISOString()}::timestamp(3))
        ON CONFLICT ("userId") DO UPDATE
          SET "token" = EXCLUDED."token", "lockedUntil" = EXCLUDED."lockedUntil"
          WHERE "FactGenerationLock"."lockedUntil" < ${now.toISOString()}::timestamp(3)
        RETURNING "token"
      `;
      return rows[0]?.token === token ? token : null;
    },

    async releaseLock(userId, token) {
      // Only delete the lease if it is still ours (it may have expired and been taken over).
      await prisma.factGenerationLock.deleteMany({ where: { userId, token } });
    },
  };
}
