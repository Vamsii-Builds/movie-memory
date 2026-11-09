import { describe, expect, it } from "vitest";
import { CACHE_TTL_MS, createFactService, FactServiceError, isFresh } from "@/lib/facts/service";
import { fakeClock, InMemoryFactRepo, stubGenerator } from "./helpers";

function setup(movie: string | null = "Inception") {
  const repo = new InMemoryFactRepo();
  repo.addUser("alice", movie);
  const clock = fakeClock();
  const generator = stubGenerator();
  const service = createFactService({ repo, generator, now: clock.now, sleep: clock.sleep, log: () => {} });
  return { repo, clock, generator, service };
}

describe("60-second cache window", () => {
  it("generates and stores a fact when none exists", async () => {
    const { repo, generator, service } = setup();
    const result = await service.getFactForUser("alice");
    expect(result.source).toBe("generated");
    expect(generator.calls()).toBe(1);
    expect(repo.facts).toHaveLength(1);
    expect(repo.facts[0]).toMatchObject({ userId: "alice", movie: "Inception" });
  });

  it("returns the cached fact when the latest one is under 60s old", async () => {
    const { clock, generator, service } = setup();
    const first = await service.getFactForUser("alice");
    clock.advance(59_999);
    const second = await service.getFactForUser("alice");
    expect(second.source).toBe("cache");
    expect(second.fact.id).toBe(first.fact.id);
    expect(generator.calls()).toBe(1);
  });

  it("generates a new fact once the latest one is exactly 60s old (boundary)", async () => {
    const { repo, clock, generator, service } = setup();
    const first = await service.getFactForUser("alice");
    clock.advance(CACHE_TTL_MS);
    const second = await service.getFactForUser("alice");
    expect(second.source).toBe("generated");
    expect(second.fact.id).not.toBe(first.fact.id);
    expect(generator.calls()).toBe(2);
    expect(repo.facts).toHaveLength(2); // history is kept
  });

  it("does not reuse a fact about a different (previous) movie", async () => {
    const { repo, clock, generator, service } = setup("Inception");
    repo.addFact("alice", "Up", "old fact about Up", clock.now());
    const result = await service.getFactForUser("alice");
    expect(result.source).toBe("generated");
    expect(result.fact.movie).toBe("Inception");
    expect(generator.calls()).toBe(1);
  });

  it("isFresh treats future-dated and missing facts as not fresh", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    expect(isFresh(null, now)).toBe(false);
    const future = { id: "x", userId: "u", movie: "m", content: "c", createdAt: new Date(now.getTime() + 1000) };
    expect(isFresh(future, now)).toBe(false);
  });

  it("errors with NO_MOVIE when the user hasn't onboarded", async () => {
    const { service } = setup(null);
    await expect(service.getFactForUser("alice")).rejects.toMatchObject({ code: "NO_MOVIE" });
  });
});

describe("OpenAI failure handling", () => {
  it("returns the most recent (stale) fact when OpenAI fails", async () => {
    const repo = new InMemoryFactRepo();
    repo.addUser("alice", "Inception");
    const clock = fakeClock();
    const old = repo.addFact("alice", "Inception", "old fact", clock.now());
    clock.advance(5 * 60_000);
    const generator = stubGenerator(async () => {
      throw new Error("timeout");
    });
    const service = createFactService({ repo, generator, now: clock.now, sleep: clock.sleep, log: () => {} });

    const result = await service.getFactForUser("alice");
    expect(result).toEqual({ fact: old, source: "fallback" });
    expect(repo.locks.size).toBe(0); // lease released even on failure
  });

  it("returns a friendly error when OpenAI fails and there is no cached fact", async () => {
    const repo = new InMemoryFactRepo();
    repo.addUser("alice", "Inception");
    const generator = stubGenerator(async () => {
      throw new Error("500 from OpenAI");
    });
    const service = createFactService({ repo, generator, log: () => {} });

    const err = await service.getFactForUser("alice").catch((e) => e);
    expect(err).toBeInstanceOf(FactServiceError);
    expect(err.code).toBe("GENERATION_FAILED");
    expect(err.status).toBe(503);
    expect(err.message).not.toMatch(/500 from OpenAI/); // no internals leaked
  });
});

describe("burst / idempotency protection", () => {
  it("concurrent requests (multiple tabs) trigger exactly one OpenAI call", async () => {
    const repo = new InMemoryFactRepo();
    repo.addUser("alice", "Inception");
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const generator = stubGenerator(async (movie) => {
      await gate; // hold the first generation "in flight"
      return `slow fact about ${movie}`;
    });
    // Real clock, tiny poll interval so the waiters notice the result quickly.
    const service = createFactService({ repo, generator, pollIntervalMs: 5, log: () => {} });

    const requests = Array.from({ length: 5 }, () => service.getFactForUser("alice"));
    await new Promise((r) => setTimeout(r, 20));
    release();
    const results = await Promise.all(requests);

    expect(generator.calls()).toBe(1);
    expect(repo.facts).toHaveLength(1);
    expect(new Set(results.map((r) => r.fact.id)).size).toBe(1);
    expect(results.filter((r) => r.source === "generated")).toHaveLength(1);
  });

  it("a waiter that times out returns the older fact instead of calling OpenAI again", async () => {
    const repo = new InMemoryFactRepo();
    repo.addUser("alice", "Inception");
    const clock = fakeClock();
    const old = repo.addFact("alice", "Inception", "old fact", clock.now());
    clock.advance(120_000);
    // Someone else holds a live lease and never finishes.
    await repo.tryAcquireLock("alice", clock.now(), 30_000);
    const generator = stubGenerator();
    const service = createFactService({ repo, generator, now: clock.now, sleep: clock.sleep, log: () => {} });

    const result = await service.getFactForUser("alice");
    expect(result).toEqual({ fact: old, source: "fallback" });
    expect(generator.calls()).toBe(0);
  });

  it("an expired lease (crashed request) does not block generation forever", async () => {
    const repo = new InMemoryFactRepo();
    repo.addUser("alice", "Inception");
    const clock = fakeClock();
    await repo.tryAcquireLock("alice", clock.now(), 30_000);
    clock.advance(30_001);
    const generator = stubGenerator();
    const service = createFactService({ repo, generator, now: clock.now, sleep: clock.sleep, log: () => {} });

    const result = await service.getFactForUser("alice");
    expect(result.source).toBe("generated");
    expect(generator.calls()).toBe(1);
  });
});
