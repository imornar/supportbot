import "server-only";

import NextAuth from "next-auth";
import type { JWT } from "next-auth/jwt";

import { authProviders } from "@/server/auth/providers";
import {
  isProviderSubject,
  linkGitHubSignIn,
  logSignInLinkFailure,
} from "@/server/auth/provider-link";
import { getDb } from "@/server/db/client";

/**
 * JWT sessions. The token stores the GitHub provider and subject only.
 * It does not store permissions, email, or the provider access token.
 * `requirePermission` loads roles from the database on each request.
 */
export const { handlers, auth } = NextAuth({
  providers: authProviders,
  session: { strategy: "jwt" },
  callbacks: {
    async signIn({ account }) {
      if (account?.provider !== "github" || !account.providerAccountId) {
        return false;
      }
      try {
        return await linkGitHubSignIn(getDb(), {
          subject: account.providerAccountId,
          accessToken: account.access_token,
        });
      } catch (error) {
        logSignInLinkFailure(error);
        return false;
      }
    },
    async jwt({ token, account }) {
      return sessionToken(token, account);
    },
    async session({ session, token }) {
      const authProvider = token.authProvider;
      const authSubject = token.authSubject;
      return {
        expires: session.expires,
        authProvider:
          typeof authProvider === "string" ? authProvider : undefined,
        authSubject: typeof authSubject === "string" ? authSubject : undefined,
        user: {},
      };
    },
  },
});

export function sessionToken(
  token: JWT,
  account: { provider?: string; providerAccountId?: string } | null | undefined,
): JWT {
  const authProvider = account?.provider ?? token.authProvider;
  const authSubject = account?.providerAccountId ?? token.authSubject;
  if (
    authProvider !== "github" ||
    !isProviderSubject(String(authSubject ?? ""))
  ) {
    return { authProvider: "", authSubject: "" };
  }
  return { authProvider, authSubject };
}

export async function readSessionSubject(): Promise<{
  provider: string;
  subject: string;
} | null> {
  const session = await auth();
  if (session?.authProvider !== "github") {
    return null;
  }
  if (!session.authSubject || !isProviderSubject(session.authSubject)) {
    return null;
  }
  return { provider: session.authProvider, subject: session.authSubject };
}
