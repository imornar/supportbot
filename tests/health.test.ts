import { describe, expect, it, vi } from "vitest";
import { pingConnectionString } from "@/server/db/ping";
import { poolConfig, requireDatabaseUrl } from "@/server/db/client";
import {
  healthBody,
  readinessBody,
  readinessHttpStatus,
} from "@/server/health";

const plantedDatabaseUrl =
  "postgresql://user:super-secret-password@db.internal:5432/supportpilot";

describe("health responses", () => {
  it("returns a status and nothing else", () => {
    expect(healthBody()).toEqual({ status: "ok" });
  });

  it("reports a missing database without connection details", () => {
    const body = readinessBody("not_configured");
    expect(body).toEqual({
      status: "not_ready",
      database: "not_configured",
    });
    expect(readinessHttpStatus(body)).toBe(503);
    expect(JSON.stringify(body)).not.toContain("postgresql://");
  });

  it("reports a reachable database without echoing the URL", () => {
    const body = readinessBody("up");
    expect(body).toEqual({ status: "ready", database: "up" });
    expect(readinessHttpStatus(body)).toBe(200);
    expect(JSON.stringify(body)).not.toContain("super-secret-password");
    expect(JSON.stringify(body)).not.toContain("db.internal");
  });

  it("reports an unreachable database as not ready", () => {
    const body = readinessBody("down");
    expect(body).toEqual({ status: "not_ready", database: "down" });
    expect(readinessHttpStatus(body)).toBe(503);
  });
});

describe("pool configuration", () => {
  it("keeps a single shared connection on Vercel and a larger local pool", () => {
    const previous = process.env.VERCEL;
    process.env.VERCEL = "1";
    try {
      expect(poolConfig("postgresql://localhost/supportpilot").max).toBe(1);
    } finally {
      if (previous === undefined) {
        delete process.env.VERCEL;
      } else {
        process.env.VERCEL = previous;
      }
    }

    expect(poolConfig("postgresql://localhost/supportpilot").max).toBe(10);
  });
});

describe("database probe", () => {
  it("fails a closed port without logging the connection string", async () => {
    const errors: unknown[][] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => {
      errors.push(args);
    });

    try {
      const state = await pingConnectionString(
        "postgresql://user:super-secret-password@127.0.0.1:1/supportpilot",
      );
      expect(state).toBe("down");
      const logged = JSON.stringify(errors);
      expect(logged).not.toContain("super-secret-password");
      expect(logged).not.toContain("postgresql://");
      expect(logged).not.toContain("127.0.0.1");
    } finally {
      spy.mockRestore();
    }
  });

  it("refuses to open a pool when DATABASE_URL is missing, without echoing other secrets", () => {
    expect(() =>
      requireDatabaseUrl({
        DATABASE_URL: "   ",
        OPENAI_API_KEY: "sk-live-secret-value",
      }),
    ).toThrow(/DATABASE_URL is not configured/);

    try {
      requireDatabaseUrl({ OPENAI_API_KEY: "sk-live-secret-value" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain("Values are omitted");
      expect(message).not.toContain("sk-live-secret-value");
      expect(message).not.toContain(plantedDatabaseUrl);
    }
  });
});
