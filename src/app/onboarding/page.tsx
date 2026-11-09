import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { OnboardingForm } from "@/components/OnboardingForm";

export default async function OnboardingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (user.favoriteMovie) redirect("/dashboard");

  const firstName = user.name?.trim().split(/\s+/)[0];

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8">
        <h1 className="text-2xl font-semibold">Welcome{firstName ? `, ${firstName}` : ""}!</h1>
        <p className="mt-2 text-zinc-400">What&apos;s your favorite movie?</p>
        <OnboardingForm />
      </div>
    </main>
  );
}
