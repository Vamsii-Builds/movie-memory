import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFactService } from "@/lib/facts/service";
import { fakeClock, InMemoryFactRepo, stubGenerator } from "./helpers";

// --- Service level: data is always scoped to the given user -----------------
describe("fact service authorization", () => {
  it("never returns another user's fact, even for the same movie", async () => {
    const repo = new InMemoryFactRepo();
    const clock = fakeClock();
    repo.addUser("alice", "Inception");
    repo.addUser("bob", "Inception");
    const bobsFact = repo.addFact("bob", "Inception", "bob's private fact", clock.now());

    const generator = stubGenerator();
    const service = createFactService({ repo, generator, now: clock.now, sleep: clock.sleep, log: () => {} });

    const result = await service.getFactForUser("alice");
    expect(result.fact.userId).toBe("alice");
    expect(result.fact.id).not.toBe(bobsFact.id);
    expect(result.fact.content).not.toBe("bob's private fact");
  });

  it("a user without a movie cannot fall through to someone else's facts", async () => {
    const repo = new InMemoryFactRepo();
    const clock = fakeClock();
    repo.addUser("alice", null);
    repo.addUser("bob", "Inception");
    repo.addFact("bob", "Inception", "bob's fact", clock.now());
    const service = createFactService({ repo, generator: stubGenerator(), now: clock.now, log: () => {} });

    await expect(service.getFactForUser("alice")).rejects.toMatchObject({ code: "NO_MOVIE" });
  });
});

// --- Route level: identity comes only from the session ----------------------
const getSessionUserId = vi.fn<() => Promise<string | null>>();
const getFactForUser = vi.fn();

vi.mock("@/lib/auth", () => ({ getSessionUserId: () => getSessionUserId() }));
vi.mock("@/lib/facts", () => ({ getFactService: () => ({ getFactForUser }) }));

describe("GET /api/fact authorization", () => {
  beforeEach(() => {
    getSessionUserId.mockReset();
    getFactForUser.mockReset();
  });

  it("returns 401 and never touches the fact service when signed out", async () => {
    getSessionUserId.mockResolvedValue(null);
    const { GET } = await import("@/app/api/fact/route");
    const res = await GET();
    expect(res.status).toBe(401);
    expect(getFactForUser).not.toHaveBeenCalled();
  });

  it("loads facts for the session user only", async () => {
    getSessionUserId.mockResolvedValue("alice");
    getFactForUser.mockResolvedValue({
      fact: { id: "f1", userId: "alice", movie: "Inception", content: "fact", createdAt: new Date() },
      source: "generated",
    });
    const { GET } = await import("@/app/api/fact/route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(getFactForUser).toHaveBeenCalledWith("alice");
    const body = await res.json();
    expect(body.fact).not.toHaveProperty("userId"); // internal ids not exposed
  });

  it("maps service errors to a friendly JSON error", async () => {
    getSessionUserId.mockResolvedValue("alice");
    const { FactServiceError } = await import("@/lib/facts/service");
    getFactForUser.mockRejectedValue(new FactServiceError("GENERATION_FAILED", "Try again soon.", 503));
    const { GET } = await import("@/app/api/fact/route");
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: { code: "GENERATION_FAILED", message: "Try again soon." } });
  });
});
