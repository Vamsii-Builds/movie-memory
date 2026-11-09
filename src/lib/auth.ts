import "server-only";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import type { NextAuthOptions } from "next-auth";
import type { Adapter } from "next-auth/adapters";
import { getServerSession } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { prisma } from "@/lib/db";

export const authOptions: NextAuthOptions = {
  // Users, accounts and sessions are persisted in Postgres via Prisma.
  // (The adapter is typed against the classic @prisma/client; the shape is identical.)
  adapter: PrismaAdapter(prisma as never) as Adapter,
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    }),
  ],
  // Database sessions: the browser only holds an opaque session token, and
  // logging out deletes the session row server-side.
  session: { strategy: "database" },
  pages: {
    signIn: "/", // our landing page is the login page
    error: "/", // auth errors come back as /?error=...
  },
  callbacks: {
    session({ session, user }) {
      if (session.user) session.user.id = user.id;
      return session;
    },
  },
};

/** The signed-in user's id, taken ONLY from the server-side session. */
export async function getSessionUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  return session?.user?.id ?? null;
}

export type CurrentUser = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  favoriteMovie: string | null;
};

/** Loads the signed-in user's profile from the DB, or null if signed out. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const userId = await getSessionUserId();
  if (!userId) return null;
  return prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, image: true, favoriteMovie: true },
  });
}
