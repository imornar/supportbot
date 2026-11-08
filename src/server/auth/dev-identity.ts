import "server-only";

import { seedUsers } from "@/server/db/seed-data";

export const DEV_IDENTITY_FLAG = "SUPPORTPILOT_ALLOW_DEV_IDENTITY";
export const DEV_USER_HEADER = "x-supportpilot-dev-user";
export const DEV_USER_COOKIE = "supportpilot-dev-user";
export const DEV_USER_QUERY = "devUser";

const seedUserIds = new Set<string>(seedUsers.map((user) => user.id));

export type DevIdentitySignals = {
  header: string | null;
  cookie: string | null;
  query: string | null;
};

export type DevIdentityDecision =
  | { status: "absent" }
  | { status: "rejected" }
  | { status: "accepted"; userId: string };

export function productionConfiguration(
  env: Record<string, string | undefined>,
): boolean {
  return env.NODE_ENV === "production" || env.VERCEL_ENV === "production";
}

/**
 * The selector is on only when the flag is the exact string "true" and this
 * process is not production. Vercel preview also sets NODE_ENV=production, so
 * the selector stays off there.
 */
export function devIdentityEnabled(
  env: Record<string, string | undefined>,
): boolean {
  return env[DEV_IDENTITY_FLAG] === "true" && !productionConfiguration(env);
}

export function isSeedDevUser(userId: string): boolean {
  return seedUserIds.has(userId);
}

export function readCookie(
  cookieHeader: string | null,
  name: string,
): string | null {
  if (!cookieHeader) {
    return null;
  }
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const key = part.slice(0, separator).trim();
    if (key !== name) {
      continue;
    }
    const raw = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return null;
    }
  }
  return null;
}

export function devIdentitySignals(request: Request): DevIdentitySignals {
  return {
    header: request.headers.get(DEV_USER_HEADER),
    cookie: readCookie(request.headers.get("cookie"), DEV_USER_COOKIE),
    query: new URL(request.url).searchParams.get(DEV_USER_QUERY),
  };
}

export function decideDevIdentity(
  env: Record<string, string | undefined>,
  signals: DevIdentitySignals,
): DevIdentityDecision {
  const present = [signals.header, signals.cookie, signals.query]
    .filter((value): value is string => value !== null && value.trim() !== "")
    .map((value) => value.trim());

  if (present.length === 0) {
    return { status: "absent" };
  }
  if (!devIdentityEnabled(env)) {
    return { status: "rejected" };
  }
  const [userId] = present;
  if (!userId || present.some((value) => value !== userId)) {
    return { status: "rejected" };
  }
  if (!isSeedDevUser(userId)) {
    return { status: "rejected" };
  }
  return { status: "accepted", userId };
}

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) {
    return false;
  }
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function devIdentityCookieOptions(request: Request): {
  httpOnly: true;
  sameSite: "lax";
  path: "/";
  secure: boolean;
} {
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: new URL(request.url).protocol === "https:",
  };
}
