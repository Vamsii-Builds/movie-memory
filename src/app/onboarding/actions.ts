"use server";

import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { validateMovieTitle } from "@/lib/movie";

export type OnboardingState = { error: string | null };

export async function saveFavoriteMovie(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  // Identity comes from the session cookie, never from the form.
  const userId = await getSessionUserId();
  if (!userId) redirect("/");

  const result = validateMovieTitle(formData.get("movie"));
  if (!result.ok) return { error: result.error };

  // Onboarding is first-time only: only set the movie if it isn't set yet.
  // If it's already set (e.g. a second tab), this is a no-op and we just move on.
  await prisma.user.updateMany({
    where: { id: userId, favoriteMovie: null },
    data: { favoriteMovie: result.movie },
  });

  redirect("/dashboard");
}
