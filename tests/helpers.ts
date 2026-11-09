import type { FactGenerator, FactRepository, StoredFact } from "@/lib/facts/service";

/** In-memory FactRepository with the same semantics as the Prisma one. */
export class InMemoryFactRepo implements FactRepository {
  users = new Map<string, { favoriteMovie: string | null }>();
  facts: StoredFact[] = [];
  locks = new Map<string, { token: string; lockedUntil: number }>();
  private seq = 0;

  addUser(id: string, favoriteMovie: string | null) {
    this.users.set(id, { favoriteMovie });
  }

  addFact(userId: string, movie: string, content: string, createdAt: Date): StoredFact {
    const fact = { id: `f${++this.seq}`, userId, movie, content, createdAt };
    this.facts.push(fact);
    return fact;
  }

  async getFavoriteMovie(userId: string) {
    return this.users.get(userId)?.favoriteMovie ?? null;
  }

  async findLatestFact(userId: string, movie: string) {
    const mine = this.facts.filter((f) => f.userId === userId && f.movie === movie);
    mine.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return mine[0] ?? null;
  }

  async createFact(input: { userId: string; movie: string; content: string; createdAt: Date }) {
    return this.addFact(input.userId, input.movie, input.content, input.createdAt);
  }

  async tryAcquireLock(userId: string, now: Date, leaseMs: number) {
    const existing = this.locks.get(userId);
    if (existing && existing.lockedUntil >= now.getTime()) return null;
    const token = `t${++this.seq}`;
    this.locks.set(userId, { token, lockedUntil: now.getTime() + leaseMs });
    return token;
  }

  async releaseLock(userId: string, token: string) {
    if (this.locks.get(userId)?.token === token) this.locks.delete(userId);
  }
}

/** Controllable clock; sleep() advances it instead of waiting in real time. */
export function fakeClock(start = new Date("2026-01-01T00:00:00.000Z")) {
  let t = start.getTime();
  return {
    now: () => new Date(t),
    advance: (ms: number) => {
      t += ms;
    },
    sleep: async (ms: number) => {
      t += ms;
      await Promise.resolve();
    },
  };
}

/** Generator stub that counts calls; optionally fails or resolves on demand. */
export function stubGenerator(impl?: (movie: string) => Promise<string>) {
  let calls = 0;
  const gen: FactGenerator & { calls: () => number } = {
    async generate(movie) {
      calls++;
      return impl ? impl(movie) : `fact #${calls} about ${movie}`;
    },
    calls: () => calls,
  };
  return gen;
}
