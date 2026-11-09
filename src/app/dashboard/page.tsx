import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Avatar } from "@/components/Avatar";
import { FactCard } from "@/components/FactCard";
import { SignOutButton } from "@/components/SignOutButton";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!user.favoriteMovie) redirect("/onboarding");

  // Google may not provide a name or photo — fall back gracefully.
  const displayName = user.name?.trim() || user.email?.split("@")[0] || "Movie fan";

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <header className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar src={user.image} name={displayName} />
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold">{displayName}</p>
            <p className="truncate text-sm text-zinc-400">{user.email ?? "No email on file"}</p>
          </div>
        </div>
        <SignOutButton />
      </header>

      <section className="mt-10 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
        <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">Favorite movie</p>
        <p className="mt-1 text-2xl font-bold">{user.favoriteMovie}</p>
      </section>

      <FactCard />
    </main>
  );
}
