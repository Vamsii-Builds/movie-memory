"use client";

import { useActionState } from "react";
import { saveFavoriteMovie, type OnboardingState } from "@/app/onboarding/actions";
import { MOVIE_MAX_LENGTH } from "@/lib/movie";

const initialState: OnboardingState = { error: null };

export function OnboardingForm() {
  const [state, formAction, pending] = useActionState(saveFavoriteMovie, initialState);

  return (
    <form action={formAction} className="mt-6 space-y-4">
      <label htmlFor="movie" className="sr-only">
        Favorite movie
      </label>
      {/* maxLength/required are UX only — the server validates again. */}
      <input
        id="movie"
        name="movie"
        type="text"
        required
        maxLength={MOVIE_MAX_LENGTH}
        autoFocus
        placeholder="e.g. Spirited Away"
        aria-invalid={state.error ? true : undefined}
        aria-describedby={state.error ? "movie-error" : undefined}
        className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-4 py-3 outline-none focus:border-indigo-500"
      />
      {state.error && (
        <p id="movie-error" role="alert" className="text-sm text-red-400">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-indigo-600 px-4 py-3 font-medium transition hover:bg-indigo-500 disabled:opacity-60"
      >
        {pending ? "Saving…" : "Continue"}
      </button>
    </form>
  );
}
