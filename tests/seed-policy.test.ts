import { describe, expect, it } from "vitest";
import { developmentSeedAllowed } from "@/server/db/seed-policy";
import { seedDevelopmentDatabase } from "@/server/db/seed";

describe("development seed", () => {
  it("allows a local non-production environment", () => {
    expect(developmentSeedAllowed({ NODE_ENV: "development" })).toBe(true);
    expect(developmentSeedAllowed({ NODE_ENV: "test" })).toBe(true);
  });

  it("refuses production, Vercel, and preview", () => {
    expect(developmentSeedAllowed({ NODE_ENV: "production" })).toBe(false);
    expect(
      developmentSeedAllowed({ VERCEL: "1", NODE_ENV: "development" }),
    ).toBe(false);
    expect(developmentSeedAllowed({ VERCEL_ENV: "preview" })).toBe(false);
    expect(developmentSeedAllowed({ VERCEL_ENV: "production" })).toBe(false);
  });

  it("throws before connecting when the environment is production", async () => {
    await expect(
      seedDevelopmentDatabase(
        "postgresql://invalid.example/should-not-connect",
        {
          NODE_ENV: "production",
        },
      ),
    ).rejects.toThrow(/Refusing to seed/);
  });
});
