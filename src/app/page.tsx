import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { SignInButton } from "@/components/SignInButton";

const AUTH_ERRORS: Record<string, string> = {
  OAuthAccountNotLinked: "That email is already linked to a different sign-in method.",
  AccessDenied: "Access was denied.",
};

export default async function LandingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  // Signed-in users never see the landing page: first-timers go to onboarding,
  // returning users (who already have a movie) go to the dashboard.
  const user = await getCurrentUser();
  if (user) redirect(user.favoriteMovie ? "/dashboard" : "/onboarding");

  const { error } = await searchParams;
  const errorMessage = error ? (AUTH_ERRORS[error] ?? "Sign-in failed. Please try again.") : null;

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        <p className="text-5xl" aria-hidden>
          🎬
        </p>
        <h1 className="mt-4 text-4xl font-bold tracking-tight">Movie Memory</h1>
        <p className="mt-3 text-zinc-400">
          Tell us your favorite movie and get a fun fact about it.
        </p>
        {errorMessage && (
          <p role="alert" className="mt-6 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {errorMessage}
          </p>
        )}
        <div className="mt-8">
          <SignInButton />
        </div>
      </div>
    </main>
  );
}
