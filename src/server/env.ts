import "server-only";

import { z } from "zod";

const publicConfigError =
  "Invalid public configuration: NEXT_PUBLIC_APP_URL is missing or not an http(s) URL. See .env.example. Values are omitted.";

const publicEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().trim().refine(isHttpUrl),
});

export type PublicEnv = {
  appUrl: string;
};

export function parsePublicEnv(
  source: Record<string, string | undefined>,
): PublicEnv {
  const parsed = publicEnvSchema.safeParse({
    NEXT_PUBLIC_APP_URL: source.NEXT_PUBLIC_APP_URL,
  });

  if (!parsed.success) {
    throw new Error(publicConfigError);
  }

  return { appUrl: parsed.data.NEXT_PUBLIC_APP_URL };
}

export function getPublicEnv(): PublicEnv {
  return parsePublicEnv(process.env);
}

export function databaseReadiness(
  source: Record<string, string | undefined> = process.env,
): "configured" | "not_configured" {
  const value = source.DATABASE_URL;
  if (typeof value === "string" && value.trim().length > 0) {
    return "configured";
  }
  return "not_configured";
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
