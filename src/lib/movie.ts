import { z } from "zod";

export const MOVIE_MIN_LENGTH = 1;
export const MOVIE_MAX_LENGTH = 100;

/**
 * Server-side validation for a favorite movie title.
 * - trims and collapses internal whitespace ("  The   Matrix " -> "The Matrix")
 * - rejects control characters
 * - enforces min/max length AFTER normalisation
 */
export const movieTitleSchema = z
  .string({ invalid_type_error: "Please enter a movie title." })
  .transform((s) => s.trim().replace(/\s+/g, " "))
  .pipe(
    z
      .string()
      .min(MOVIE_MIN_LENGTH, "Please enter a movie title.")
      .max(MOVIE_MAX_LENGTH, `Movie title must be at most ${MOVIE_MAX_LENGTH} characters.`)
      // eslint-disable-next-line no-control-regex
      .refine((s) => !/[\u0000-\u001f\u007f]/.test(s), "Movie title contains invalid characters."),
  );

export type MovieValidationResult =
  | { ok: true; movie: string }
  | { ok: false; error: string };

export function validateMovieTitle(input: unknown): MovieValidationResult {
  const parsed = movieTitleSchema.safeParse(input);
  if (parsed.success) return { ok: true, movie: parsed.data };
  return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid movie title." };
}
