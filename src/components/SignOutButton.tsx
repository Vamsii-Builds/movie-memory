"use client";

import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <button
      type="button"
      onClick={() => void signOut({ callbackUrl: "/" })}
      className="shrink-0 rounded-full border border-zinc-700 px-4 py-2 text-sm font-medium transition hover:bg-zinc-800"
    >
      Log out
    </button>
  );
}
