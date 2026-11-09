import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";
import { getFactService } from "@/lib/facts";
import { CACHE_TTL_MS, FactServiceError } from "@/lib/facts/service";

export const dynamic = "force-dynamic";

export type FactResponse = {
  fact: { id: string; movie: string; content: string; createdAt: string };
  source: "cache" | "generated" | "fallback";
  /** When a new fact can be generated (end of the 60s cache window). */
  freshUntil: string;
};

export type FactErrorResponse = { error: { code: string; message: string } };

/**
 * GET /api/fact — fun fact for the SIGNED-IN user's favorite movie.
 *
 * The user is identified only by the server-side session. The endpoint takes
 * no user id or movie parameter, so there is no way to ask for someone else's facts.
 */
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json<FactErrorResponse>(
      { error: { code: "UNAUTHORIZED", message: "Please sign in." } },
      { status: 401 },
    );
  }

  try {
    const { fact, source } = await getFactService().getFactForUser(userId);
    return NextResponse.json<FactResponse>(
      {
        fact: {
          id: fact.id,
          movie: fact.movie,
          content: fact.content,
          createdAt: fact.createdAt.toISOString(),
        },
        source,
        freshUntil: new Date(fact.createdAt.getTime() + CACHE_TTL_MS).toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    if (err instanceof FactServiceError) {
      return NextResponse.json<FactErrorResponse>(
        { error: { code: err.code, message: err.message } },
        { status: err.status },
      );
    }
    console.error("[api/fact] unexpected error", err);
    return NextResponse.json<FactErrorResponse>(
      { error: { code: "INTERNAL", message: "Something went wrong. Please try again." } },
      { status: 500 },
    );
  }
}
