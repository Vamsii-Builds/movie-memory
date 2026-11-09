/**
 * Integration tests against a real Postgres (skipped unless TEST_DATABASE_URL is set).
 *   TEST_DATABASE_URL=postgresql://... npm test
 * The database must already be migrated (npx prisma migrate deploy).
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { createPrismaFactRepository } from "@/lib/facts/prisma-repository";
import { createFactService } from "@/lib/facts/service";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("Prisma repository (Postgres)", () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  const repo = createPrismaFactRepository(prisma);
  const A = "it-user-a";
  const B = "it-user-b";

  beforeEach(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [A, B] } } });
    await prisma.user.createMany({
      data: [
        { id: A, email: "a@test.local", favoriteMovie: "Inception" },
        { id: B, email: "b@test.local", favoriteMovie: "Inception" },
      ],
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [A, B] } } });
    await prisma.$disconnect();
  });

  it("exactly one of many concurrent lock attempts wins", async () => {
    const now = new Date();
    const tokens = await Promise.all(Array.from({ length: 20 }, () => repo.tryAcquireLock(A, now, 30_000)));
    expect(tokens.filter(Boolean)).toHaveLength(1);
  });

  it("a live lease blocks, an expired lease can be taken over, release frees it", async () => {
    const t0 = new Date();
    const first = await repo.tryAcquireLock(A, t0, 30_000);
    expect(first).toBeTruthy();
    expect(await repo.tryAcquireLock(A, new Date(t0.getTime() + 29_000), 30_000)).toBeNull();
    const second = await repo.tryAcquireLock(A, new Date(t0.getTime() + 31_000), 30_000);
    expect(second).toBeTruthy();
    // The first holder can no longer release a lease it lost.
    await repo.releaseLock(A, first!);
    expect(await repo.tryAcquireLock(A, new Date(t0.getTime() + 32_000), 30_000)).toBeNull();
    await repo.releaseLock(A, second!);
    expect(await repo.tryAcquireLock(A, new Date(t0.getTime() + 33_000), 30_000)).toBeTruthy();
  });

  it("locks are per user", async () => {
    const now = new Date();
    expect(await repo.tryAcquireLock(A, now, 30_000)).toBeTruthy();
    expect(await repo.tryAcquireLock(B, now, 30_000)).toBeTruthy();
  });

  it("latest-fact lookup is scoped to the user and movie", async () => {
    const t = Date.now();
    await repo.createFact({ userId: B, movie: "Inception", content: "b", createdAt: new Date(t) });
    await repo.createFact({ userId: A, movie: "Up", content: "a-up", createdAt: new Date(t) });
    await repo.createFact({ userId: A, movie: "Inception", content: "a-old", createdAt: new Date(t - 5000) });
    await repo.createFact({ userId: A, movie: "Inception", content: "a-new", createdAt: new Date(t - 1000) });
    expect((await repo.findLatestFact(A, "Inception"))?.content).toBe("a-new");
  });

  it("end to end: 10 concurrent requests -> one OpenAI call, one stored fact", async () => {
    let calls = 0;
    const service = createFactService({
      repo,
      pollIntervalMs: 20,
      log: () => {},
      generator: {
        async generate(movie) {
          calls++;
          await new Promise((r) => setTimeout(r, 300));
          return `fact about ${movie}`;
        },
      },
    });
    const results = await Promise.all(Array.from({ length: 10 }, () => service.getFactForUser(A)));
    expect(calls).toBe(1);
    expect(await prisma.fact.count({ where: { userId: A } })).toBe(1);
    expect(new Set(results.map((r) => r.fact.id)).size).toBe(1);
  });
});
