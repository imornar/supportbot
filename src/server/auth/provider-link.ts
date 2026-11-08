import "server-only";

import { and, eq, isNull, or } from "drizzle-orm";

import { logDatabaseFailure } from "@/server/db/client";
import { users } from "@/server/db/schema";
import type { TenantQueryClient } from "@/server/db/tenant-queries";
import { readVerifiedGitHubEmail } from "@/server/auth/github-email";

const providerPattern = /^[a-z][a-z0-9_-]{0,31}$/;

export type LinkCandidate = {
  id: string;
  email: string;
  authProvider: string | null;
  authSubject: string | null;
};

export type ProviderLinkInput = {
  provider: string;
  subject: string;
  email: string | null;
};

export function isProviderName(value: string): boolean {
  return providerPattern.test(value);
}

export function isProviderSubject(value: string): boolean {
  return value.length >= 1 && value.length <= 255 && !/\s/.test(value);
}

/**
 * A provider subject that already matches is the same person.
 * A verified email can attach a subject once, and only while both columns
 * are empty. Any other shape is a refusal.
 */
export function selectLinkTarget(
  candidates: readonly LinkCandidate[],
  input: ProviderLinkInput,
):
  | { action: "already" }
  | { action: "attach"; userId: string }
  | { action: "refuse" } {
  if (!isProviderName(input.provider) || !isProviderSubject(input.subject)) {
    return { action: "refuse" };
  }

  const bySubject = candidates.filter(
    (row) =>
      row.authProvider === input.provider && row.authSubject === input.subject,
  );
  if (bySubject.length === 1) {
    return { action: "already" };
  }
  if (bySubject.length > 1) {
    return { action: "refuse" };
  }

  const email = normalizeEmail(input.email);
  if (!email) {
    return { action: "refuse" };
  }
  const byEmail = candidates.filter((row) => row.email === email);
  if (byEmail.length !== 1) {
    return { action: "refuse" };
  }
  const match = byEmail[0];
  if (!match || match.authProvider !== null || match.authSubject !== null) {
    return { action: "refuse" };
  }
  return { action: "attach", userId: match.id };
}

export async function findUserBySubject(
  db: TenantQueryClient,
  provider: string,
  subject: string,
): Promise<{ userId: string } | null> {
  const rows = await db
    .select({ userId: users.id })
    .from(users)
    .where(
      and(eq(users.authProvider, provider), eq(users.authSubject, subject)),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function linkVerifiedProviderUser(
  db: TenantQueryClient,
  input: ProviderLinkInput,
): Promise<boolean> {
  if (!isProviderName(input.provider) || !isProviderSubject(input.subject)) {
    return false;
  }
  const email = normalizeEmail(input.email);
  const candidates = await db
    .select({
      id: users.id,
      email: users.email,
      authProvider: users.authProvider,
      authSubject: users.authSubject,
    })
    .from(users)
    .where(
      email
        ? or(
            and(
              eq(users.authProvider, input.provider),
              eq(users.authSubject, input.subject),
            ),
            eq(users.email, email),
          )
        : and(
            eq(users.authProvider, input.provider),
            eq(users.authSubject, input.subject),
          ),
    );
  const decision = selectLinkTarget(candidates, { ...input, email });
  if (decision.action === "already") {
    return true;
  }
  if (decision.action === "refuse") {
    return false;
  }
  try {
    const updated = await db
      .update(users)
      .set({
        authProvider: input.provider,
        authSubject: input.subject,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(users.id, decision.userId),
          isNull(users.authProvider),
          isNull(users.authSubject),
        ),
      )
      .returning({ id: users.id });
    return updated.length === 1;
  } catch (error) {
    if (isUniqueViolation(error)) {
      return false;
    }
    throw error;
  }
}

export async function linkGitHubSignIn(
  db: TenantQueryClient,
  input: {
    subject: string;
    accessToken?: string;
    fetchImpl?: typeof fetch;
  },
): Promise<boolean> {
  if (!isProviderSubject(input.subject)) {
    return false;
  }
  const existing = await findUserBySubject(db, "github", input.subject);
  if (existing) {
    return true;
  }
  if (!input.accessToken) {
    return false;
  }
  const email = await readVerifiedGitHubEmail(
    input.accessToken,
    input.fetchImpl,
  );
  if (!email) {
    return false;
  }
  return linkVerifiedProviderUser(db, {
    provider: "github",
    subject: input.subject,
    email,
  });
}

export function logSignInLinkFailure(error: unknown): void {
  logDatabaseFailure(error);
}

function normalizeEmail(email: string | null): string | null {
  if (!email) {
    return null;
  }
  const normalized = email.trim().toLowerCase();
  if (
    normalized.length === 0 ||
    normalized.length > 320 ||
    !/^[^@\s]+@[^@\s]+$/.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}
