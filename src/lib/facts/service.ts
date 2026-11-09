/**
 * Fact service — Variant A (caching + correctness).
 *
 * Pure business logic. All I/O is injected (repository, generator, clock,
 * sleep) so the cache window, burst protection and failure handling can be
 * unit-tested deterministically without Postgres or OpenAI.
 *
 * Flow for getFactForUser(userId):
 *   1. Look up the user's favorite movie (from the DB, never from the client).
 *   2. If the newest fact for (user, movie) is < 60s old  -> return it ("cache").
 *   3. Try to take the per-user generation lease.
 *        - Won it:  re-check the cache (a peer may have just finished), then
 *                   call OpenAI, store the fact, return it ("generated").
 *                   On OpenAI failure return the newest older fact ("fallback")
 *                   or a friendly error if there is none.
 *        - Lost it: another tab/refresh is generating right now. Poll briefly
 *                   for its result instead of calling OpenAI a second time.
 *   4. Always release the lease when done (it also expires on its own).
 */

export const CACHE_TTL_MS = 60_000;

export type StoredFact = {
  id: string;
  userId: string;
  movie: string;
  content: string;
  createdAt: Date;
};

export interface FactRepository {
  getFavoriteMovie(userId: string): Promise<string | null>;
  findLatestFact(userId: string, movie: string): Promise<StoredFact | null>;
  createFact(input: { userId: string; movie: string; content: string; createdAt: Date }): Promise<StoredFact>;
  /** Atomically acquire the user's generation lease. Returns a token, or null if someone else holds it. */
  tryAcquireLock(userId: string, now: Date, leaseMs: number): Promise<string | null>;
  /** Release the lease, but only if we still own it (token matches). */
  releaseLock(userId: string, token: string): Promise<void>;
}

export interface FactGenerator {
  generate(movie: string): Promise<string>;
}

/**
 * - cache:     a fact < 60s old was reused
 * - generated: a brand-new fact was created by this request
 * - fallback:  OpenAI failed / was busy, so an older fact is returned
 */
export type FactSource = "cache" | "generated" | "fallback";

export type FactResult = { fact: StoredFact; source: FactSource };

export type FactErrorCode = "NO_MOVIE" | "GENERATION_FAILED" | "GENERATION_BUSY";

export class FactServiceError extends Error {
  constructor(
    public readonly code: FactErrorCode,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "FactServiceError";
  }
}

export type FactServiceDeps = {
  repo: FactRepository;
  generator: FactGenerator;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  cacheTtlMs?: number;
  /** Must exceed the worst-case OpenAI call time so a live lease never expires mid-call. */
  leaseMs?: number;
  /** How long a request that lost the lease waits for the winner's fact. */
  waitForPeerMs?: number;
  pollIntervalMs?: number;
  log?: (msg: string, err?: unknown) => void;
};

export function isFresh(fact: StoredFact | null, now: Date, ttlMs = CACHE_TTL_MS): fact is StoredFact {
  if (!fact) return false;
  const ageMs = now.getTime() - fact.createdAt.getTime();
  // "less than 60 seconds old" -> strictly less than. A fact exactly 60s old is stale.
  return ageMs >= 0 && ageMs < ttlMs;
}

export function createFactService(deps: FactServiceDeps) {
  const {
    repo,
    generator,
    now = () => new Date(),
    sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
    cacheTtlMs = CACHE_TTL_MS,
    leaseMs = 30_000,
    waitForPeerMs = 8_000,
    pollIntervalMs = 250,
    log = (msg: string, err?: unknown) => console.error(msg, err),
  } = deps;

  async function generateWithLease(userId: string, movie: string, token: string): Promise<FactResult> {
    try {
      // Double-check under the lease: a peer may have stored a fact and released
      // the lease between our first cache check and our acquire.
      const latest = await repo.findLatestFact(userId, movie);
      if (isFresh(latest, now(), cacheTtlMs)) return { fact: latest, source: "cache" };

      try {
        const content = await generator.generate(movie);
        const fact = await repo.createFact({ userId, movie, content, createdAt: now() });
        return { fact, source: "generated" };
      } catch (err) {
        log(`[facts] generation failed for user ${userId}`, err);
        if (latest) return { fact: latest, source: "fallback" };
        throw new FactServiceError(
          "GENERATION_FAILED",
          "We couldn't come up with a fun fact right now. Please try again in a moment.",
          503,
        );
      }
    } finally {
      await repo.releaseLock(userId, token).catch((err) => log("[facts] failed to release lock", err));
    }
  }

  async function waitForPeer(userId: string, movie: string): Promise<FactResult> {
    const deadline = now().getTime() + waitForPeerMs;
    let latest: StoredFact | null = null;
    while (now().getTime() < deadline) {
      await sleep(pollIntervalMs);
      latest = await repo.findLatestFact(userId, movie);
      if (isFresh(latest, now(), cacheTtlMs)) return { fact: latest, source: "cache" };
    }
    // The peer is slow or failed. Never fire a second OpenAI call; degrade instead.
    if (latest) return { fact: latest, source: "fallback" };
    throw new FactServiceError(
      "GENERATION_BUSY",
      "Your fun fact is still being generated. Please try again in a few seconds.",
      503,
    );
  }

  return {
    async getFactForUser(userId: string): Promise<FactResult> {
      const movie = await repo.getFavoriteMovie(userId);
      if (!movie) {
        throw new FactServiceError("NO_MOVIE", "Set your favorite movie first.", 409);
      }

      const latest = await repo.findLatestFact(userId, movie);
      if (isFresh(latest, now(), cacheTtlMs)) return { fact: latest, source: "cache" };

      const token = await repo.tryAcquireLock(userId, now(), leaseMs);
      if (token) return generateWithLease(userId, movie, token);
      return waitForPeer(userId, movie);
    },
  };
}

export type FactService = ReturnType<typeof createFactService>;
