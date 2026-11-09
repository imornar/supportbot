import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { databaseUrlConfigured, parsePublicEnv } from "@/server/env";

function errorMessage(source: Record<string, string | undefined>): string {
  try {
    parsePublicEnv(source);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected parsePublicEnv to throw");
}

const plantedDatabaseUrl =
  "postgresql://user:super-secret-password@db.internal:5432/supportpilot";
const plantedApiKey = "sk-live-secret-value";

describe("parsePublicEnv", () => {
  it("accepts an http or https app URL", () => {
    expect(
      parsePublicEnv({ NEXT_PUBLIC_APP_URL: "http://localhost:3000" }),
    ).toEqual({ appUrl: "http://localhost:3000" });
  });

  it("fails when public config is missing without printing secret values", () => {
    const missing = errorMessage({
      DATABASE_URL: plantedDatabaseUrl,
      OPENAI_API_KEY: plantedApiKey,
    });
    const invalid = errorMessage({
      DATABASE_URL: plantedDatabaseUrl,
      OPENAI_API_KEY: plantedApiKey,
      NEXT_PUBLIC_APP_URL: plantedApiKey,
    });

    for (const message of [missing, invalid]) {
      expect(message).toContain("NEXT_PUBLIC_APP_URL");
      expect(message).toContain("Values are omitted");
      expect(message).not.toContain("super-secret-password");
      expect(message).not.toContain("sk-live-secret-value");
      expect(message).not.toContain("db.internal");
    }
  });
});

describe("databaseUrlConfigured", () => {
  it("is false when DATABASE_URL is absent", () => {
    expect(databaseUrlConfigured({})).toBe(false);
    expect(databaseUrlConfigured({ DATABASE_URL: "   " })).toBe(false);
  });

  it("is true when a URL is present and does not return that URL", () => {
    expect(databaseUrlConfigured({ DATABASE_URL: plantedDatabaseUrl })).toBe(
      true,
    );
  });
});

describe(".env.example", () => {
  it("does not publish secret names with the NEXT_PUBLIC_ prefix", () => {
    const example = readFileSync(
      path.join(process.cwd(), ".env.example"),
      "utf8",
    );
    for (const name of [
      "DATABASE_URL",
      "OPENAI_API_KEY",
      "AUTH_SECRET",
      "AUTH_GITHUB_ID",
      "AUTH_GITHUB_SECRET",
      "SENTRY_DSN",
      "RETRIEVAL_TOP_K",
      "RETRIEVAL_SIMILARITY_THRESHOLD",
    ]) {
      expect(example).not.toContain(`NEXT_PUBLIC_${name}`);
    }
    expect(example).toContain("NEXT_PUBLIC_APP_URL=");
    expect(example).toContain("RETRIEVAL_TOP_K=");
    expect(example).toContain("RETRIEVAL_SIMILARITY_THRESHOLD=");
  });
});
