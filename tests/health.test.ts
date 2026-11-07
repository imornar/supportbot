import { describe, expect, it } from "vitest";
import { databaseReadiness } from "@/server/env";
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
    const body = readinessBody(databaseReadiness({}));
    expect(body).toEqual({
      status: "not_ready",
      database: "not_configured",
    });
    expect(readinessHttpStatus(body)).toBe(503);
    expect(JSON.stringify(body)).not.toContain("postgresql://");
  });

  it("reports a configured database without echoing the URL", () => {
    const body = readinessBody(
      databaseReadiness({ DATABASE_URL: plantedDatabaseUrl }),
    );
    expect(body).toEqual({ status: "ready", database: "configured" });
    expect(readinessHttpStatus(body)).toBe(200);
    expect(JSON.stringify(body)).not.toContain("super-secret-password");
    expect(JSON.stringify(body)).not.toContain("db.internal");
  });
});
