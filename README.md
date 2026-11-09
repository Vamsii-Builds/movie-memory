# Movie Memory

Sign in with Google, tell us your favorite movie, get a fun fact about it from an LLM (Claude, or OpenAI as an alternative).

One Next.js app contains both the frontend (React Server Components + a few client components) and the backend (Route Handlers, a Server Action, Prisma/Postgres). There is nothing separate to run: `npm run dev` starts everything.

**Variant chosen: A — Backend-Focused (caching + correctness).**

---

## 1. Setup

### Requirements
- Node.js **20.19+** (22 LTS recommended) — required by Prisma 7
- Postgres 14+ (local install, or `docker compose up -d` using the included `docker-compose.yml`)
- A Google OAuth client and an Anthropic (Claude) or OpenAI API key

### Steps
```bash
# 1. Install (also runs `prisma generate` via postinstall)
npm install

# 2. Configure environment
cp .env.example .env          # then fill in the values (see below)

# 3. Start Postgres (skip if you already have one) and create the schema
docker compose up -d
npm run db:migrate            # = prisma migrate deploy

# 4. Run
npm run dev                   # http://localhost:3000
#   or production:  npm run build && npm start

# 5. Tests
npm test
```

### Google OAuth setup
1. Google Cloud Console → APIs & Services → Credentials → **Create OAuth client ID** → *Web application*.
2. Authorized JavaScript origin: `http://localhost:3000`
3. Authorized redirect URI: `http://localhost:3000/api/auth/callback/google`
4. Copy the client ID/secret into `.env`. (If the consent screen is in *Testing*, add your Google account as a test user.)

## 2. Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string |
| `NEXTAUTH_URL` | yes | Base URL of the app, e.g. `http://localhost:3000` |
| `NEXTAUTH_SECRET` | yes | Random secret for NextAuth (`openssl rand -base64 32`) |
| `GOOGLE_CLIENT_ID` | yes | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | yes | Google OAuth client secret |
| `ANTHROPIC_API_KEY` | one of the two | Claude key (server-only). When set, Claude generates the facts |
| `ANTHROPIC_MODEL` | no | Defaults to `claude-opus-5-5` |
| `OPENAI_API_KEY` | one of the two | OpenAI key (server-only), used when `ANTHROPIC_API_KEY` is empty |
| `OPENAI_MODEL` | no | Defaults to `gpt-4o-mini` |

No variable is prefixed `NEXT_PUBLIC_`, so none of them can reach the browser bundle.

## 3. Database migrations

- Apply existing migrations: `npm run db:migrate` (`prisma migrate deploy`)
- After changing `prisma/schema.prisma` in development: `npm run db:migrate:dev -- --name <change>` (`prisma migrate dev`)
- Prisma 7 reads the connection string from `prisma.config.ts`, which loads `.env`.

---

## 4. Architecture overview

```
src/
  app/
    page.tsx                     Landing page = login page. Signed-in users are redirected.
    onboarding/page.tsx          First-time only: asks for the favorite movie
    onboarding/actions.ts        Server Action: validates + saves the movie
    dashboard/page.tsx           Profile, movie, logout, <FactCard/>
    api/auth/[...nextauth]/      NextAuth (Google provider, Prisma adapter)
    api/fact/route.ts            GET /api/fact – thin HTTP layer over the fact service
  components/                    Client components (sign in/out, avatar, onboarding form, fact card)
  lib/
    auth.ts                      authOptions, getSessionUserId(), getCurrentUser()
    db.ts                        PrismaClient singleton (pg driver adapter)
    movie.ts                     Zod validation for movie titles
    facts/
      service.ts                 ★ Cache window, burst protection, failure handling (pure logic)
      prisma-repository.ts       Postgres implementation (incl. atomic lease SQL)
      claude-generator.ts        Claude call with timeout, no retries (used when ANTHROPIC_API_KEY is set)
      openai-generator.ts        OpenAI call with timeout, no retries
      index.ts                   Production wiring
prisma/schema.prisma, prisma/migrations/
tests/                           Unit tests + Postgres integration tests
```

### Auth flow
- NextAuth v4 with the Google provider and the Prisma adapter, using **database sessions**: the browser only holds an opaque, httpOnly session cookie; the session row lives in Postgres and is deleted on logout.
- `/` is the login page. After Google redirects back, the user lands on `/`, which routes on a single fact: `User.favoriteMovie` is `null` → `/onboarding`, otherwise → `/dashboard`.
- Every protected page and endpoint checks the session on the server: `/dashboard` and `/onboarding` redirect to `/` when signed out; `/api/fact` returns `401`.
- Onboarding is first-time only. The page redirects to `/dashboard` if a movie exists, and the Server Action writes with `updateMany({ where: { id, favoriteMovie: null } })`, so a second tab cannot overwrite it.

### Data model
- **User**: the standard NextAuth user plus `favoriteMovie VARCHAR(100) NULL`. A user has exactly one favorite movie, so a column is simpler than a separate table, and `NULL` doubles as "not onboarded yet". The DB column length matches the validation max.
- **Fact** `(id, userId, movie, content, createdAt)`: append-only history of every generated fact (the base requirement says to store them). `movie` is a *snapshot* of the title at generation time, so if the movie ever changes, old facts simply stop matching and the cache misses — no explicit invalidation needed. Index `(userId, movie, createdAt DESC)` makes "latest fact for this user + movie" a single index lookup.
- **FactGenerationLock** `(userId PK, token, lockedUntil)`: a short-lived lease, one row per user, used for burst protection (below).
- Everything cascades on user deletion.

### Fact generation (Variant A)
`GET /api/fact` takes **no parameters**. The user id comes from the session; the movie comes from that user's DB row. `createFactService` then does:

1. **Cache check.** If the newest fact for (user, movie) is **less than 60s old** (`age < 60_000ms`; exactly 60s counts as stale) → return it, `source: "cache"`.
2. **Acquire the per-user lease** with one atomic statement:
   ```sql
   INSERT INTO "FactGenerationLock" (...) VALUES (...)
   ON CONFLICT ("userId") DO UPDATE SET token = ..., "lockedUntil" = ...
     WHERE "FactGenerationLock"."lockedUntil" < now
   RETURNING token
   ```
   No row → insert wins. Expired lease → update takes it over. Live lease → nothing returned. Postgres serialises concurrent upserts on the same key, so **exactly one** request wins.
3. **Winner:** re-checks the cache *under the lease* (a peer may have finished and released between steps 1 and 2), calls OpenAI, stores the fact, returns `source: "generated"`, and releases the lease in `finally` (only if its token still matches).
4. **Losers** (other tabs / rapid refreshes) do **not** call OpenAI. They poll the DB every 250ms for up to 8s for the winner's fact (`source: "cache"`). If it never appears they return the most recent older fact (`"fallback"`) or a friendly "still generating, try again" 503.
5. **OpenAI failure** (10s timeout, `maxRetries: 0`, error, or empty reply): return the most recent cached fact for that movie (`"fallback"`), otherwise a friendly 503 with no internal details. The real error is only logged server-side.

The lease lasts 30s, longer than the worst-case OpenAI call (10s), so a live call never loses its lease; and because it expires on its own, a crashed request can't block a user forever.

The UI shows which case happened ("Fresh fact", "Cached", "Couldn't reach OpenAI — showing your last fact") and counts down to when a new fact can be generated, using `freshUntil` from the API.

### Security
- User identity only ever comes from the server-side session; no endpoint accepts a user id. Every query is scoped by that id.
- Movie input is validated server-side with Zod: trimmed, whitespace collapsed, 1–100 chars, no control characters. Client-side `maxLength`/`required` are UX only.
- Secrets live only in server code; `server-only` imports make accidental client imports of `db.ts`/`auth.ts` a build error.
- The movie title is user input sent to an LLM, so it is placed in the user message, delimited, and the system prompt tells the model to treat it only as a title. Output is trimmed and length-capped and rendered as plain text (React escapes it).
- Missing Google name/photo: name falls back to the email prefix, then "Movie fan"; photo falls back to an initials avatar (also if the image URL fails to load).

## 5. Tests

`npm test` runs:
- **`tests/fact-cache.test.ts`** — 60s window (59.999s → cache, exactly 60s → regenerate), facts for a previous movie are not reused, OpenAI failure → stale fallback / friendly error, lease released on failure, 5 concurrent requests → 1 OpenAI call, waiter timeout never calls OpenAI, expired lease is recoverable. Uses an injected fake clock, so no real waiting.
- **`tests/authorization.test.ts`** — a user never receives another user's fact (even for the same movie); a user with no movie can't fall through to someone else's facts; `GET /api/fact` returns 401 when signed out and only ever queries the session user; internal ids aren't exposed.
- **`tests/movie-validation.test.ts`** — trimming, empty/whitespace/non-string, max length, control characters.
- **`tests/integration/prisma-repository.test.ts`** — runs against real Postgres when `TEST_DATABASE_URL` is set (skipped otherwise): 20 concurrent lock attempts → exactly 1 winner, lease expiry/takeover/release by token, per-user locks, scoped latest-fact query, and an end-to-end burst of 10 requests → 1 OpenAI call and 1 stored fact.
  ```bash
  TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/movie_memory" npm test
  ```

---

## 6. Why Variant A
The interesting correctness problems in this app are on the server: a cache window that must be exact, concurrent requests that must not multiply paid OpenAI calls, and a third-party dependency that will sometimes fail. Those are also the parts where a bug costs money or leaks data, so they're where I wanted to spend the time and the tests.

## 7. Key tradeoffs
- **Lease row vs. holding a DB transaction/advisory lock during the OpenAI call.** A transaction lock would tie up a pooled connection for up to 10s per generation. The lease row is held for milliseconds, survives across instances (unlike an in-memory lock), and self-heals via expiry. Cost: losers poll instead of being notified.
- **Losers wait-and-poll instead of failing fast.** Gives every tab the same new fact at the cost of up to 8s of waiting; on timeout they degrade to the older fact rather than making a second OpenAI call.
- **App clock for timestamps.** `createdAt` and lease times are written from the app's clock so the service is fully testable with a fake clock. With several app instances, small clock skew could shift the window by that skew; acceptable here, and the DB clock (`now()`) would be the fix.
- **Lock is per user, not per (user, movie).** A user has one movie at a time, so this is simpler and equivalent.
- **Fallback only uses facts for the current movie.** Showing a fact about a previous movie would be wrong, so it shows an error instead.
- **No automatic OpenAI retries.** Keeps worst-case latency at ~10s and within the lease; the cached fallback covers transient errors.
- **Database sessions over JWT.** Real logout (row deleted) and no user data in the cookie, at the cost of one DB read per request.

## 8. With 2 more hours
- Rate limit `/api/fact` per user (the cache bounds OpenAI cost, but not request volume).
- Use the DB clock (`now()`) for cache/lease decisions to remove multi-instance clock skew.
- Let losers wait on Postgres `LISTEN/NOTIFY` instead of polling.
- Playwright E2E test for the full Google → onboarding → dashboard flow with a mocked provider.
- Structured logging + metrics for cache hit rate, OpenAI latency and failures.
- A daily cleanup job for old facts if history grows large.

## 9. AI usage
- Used an AI assistant (Claude) to scaffold the project structure, Prisma schema, NextAuth wiring and Tailwind UI.
- Used it to talk through concurrency options (transaction lock vs. lease row vs. unique-per-window constraint) before picking the lease row.
- Used it to draft the tests and this README.
- I reviewed every file, ran the tests against a real Postgres, and verified the flows (onboarding, cache, concurrent requests, OpenAI failure fallback, logout) by running the app.
