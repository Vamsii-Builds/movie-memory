import { describe, expect, it } from "vitest";
import { MOVIE_MAX_LENGTH, validateMovieTitle } from "@/lib/movie";

describe("validateMovieTitle", () => {
  it("trims and collapses whitespace", () => {
    expect(validateMovieTitle("   The    Matrix  ")).toEqual({ ok: true, movie: "The Matrix" });
  });

  it.each([["", "empty"], ["     ", "whitespace only"], [null, "missing"], [42, "not a string"]])(
    "rejects %j (%s)",
    (input, _label) => {
      expect(validateMovieTitle(input).ok).toBe(false);
    },
  );

  it("enforces the max length after trimming", () => {
    expect(validateMovieTitle(`  ${"a".repeat(MOVIE_MAX_LENGTH)}  `).ok).toBe(true);
    expect(validateMovieTitle("a".repeat(MOVIE_MAX_LENGTH + 1)).ok).toBe(false);
  });

  it("rejects control characters", () => {
    expect(validateMovieTitle("Up\u0000").ok).toBe(false);
  });
});
