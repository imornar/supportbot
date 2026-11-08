import { afterEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/dev-identity/route";
import {
  DEV_USER_COOKIE,
  decideDevIdentity,
  devIdentityEnabled,
  isSameOrigin,
} from "@/server/auth/dev-identity";
import { seedUsers } from "@/server/db/seed-data";

const ada = seedUsers[0].id;
const ken = seedUsers[1].id;
const env = process.env as Record<string, string | undefined>;
const originalFlag = env.SUPPORTPILOT_ALLOW_DEV_IDENTITY;
const originalNodeEnv = env.NODE_ENV;
const originalVercelEnv = env.VERCEL_ENV;

afterEach(() => {
  env.SUPPORTPILOT_ALLOW_DEV_IDENTITY = originalFlag;
  env.NODE_ENV = originalNodeEnv;
  env.VERCEL_ENV = originalVercelEnv;
});

describe("development identity policy", () => {
  it("accepts a seeded user only when the flag is exactly true and production is off", () => {
    expect(
      devIdentityEnabled({
        NODE_ENV: "development",
        SUPPORTPILOT_ALLOW_DEV_IDENTITY: "true",
      }),
    ).toBe(true);
    expect(
      devIdentityEnabled({
        NODE_ENV: "test",
        SUPPORTPILOT_ALLOW_DEV_IDENTITY: "true",
      }),
    ).toBe(true);
    expect(
      decideDevIdentity(
        {
          NODE_ENV: "development",
          SUPPORTPILOT_ALLOW_DEV_IDENTITY: "true",
        },
        { header: ada, cookie: null, query: null },
      ),
    ).toEqual({ status: "accepted", userId: ada });
  });

  it("rejects the header, cookie, and query param when the flag is off", () => {
    const off = {
      NODE_ENV: "development",
      SUPPORTPILOT_ALLOW_DEV_IDENTITY: "false",
    };
    expect(devIdentityEnabled(off)).toBe(false);
    for (const signals of [
      { header: ada, cookie: null, query: null },
      { header: null, cookie: ada, query: null },
      { header: null, cookie: null, query: ada },
    ]) {
      expect(decideDevIdentity(off, signals)).toEqual({ status: "rejected" });
    }
  });

  it("rejects every channel when NODE_ENV or Vercel production is active, even if the flag is true", () => {
    const channels = [
      { header: ada, cookie: null, query: null },
      { header: null, cookie: ada, query: null },
      { header: null, cookie: null, query: ada },
    ];
    const productionEnvs = [
      { NODE_ENV: "production", SUPPORTPILOT_ALLOW_DEV_IDENTITY: "true" },
      {
        NODE_ENV: "development",
        VERCEL_ENV: "production",
        SUPPORTPILOT_ALLOW_DEV_IDENTITY: "true",
      },
    ];
    for (const production of productionEnvs) {
      expect(devIdentityEnabled(production)).toBe(false);
      for (const signals of channels) {
        expect(decideDevIdentity(production, signals)).toEqual({
          status: "rejected",
        });
      }
    }
  });

  it("rejects a non-seed user and disagreeing channels", () => {
    const enabled = {
      NODE_ENV: "development",
      SUPPORTPILOT_ALLOW_DEV_IDENTITY: "true",
    };
    expect(
      decideDevIdentity(enabled, {
        header: "00000000-0000-4000-8000-000000000099",
        cookie: null,
        query: null,
      }),
    ).toEqual({ status: "rejected" });
    expect(
      decideDevIdentity(enabled, {
        header: ada,
        cookie: ken,
        query: null,
      }),
    ).toEqual({ status: "rejected" });
  });

  it("is absent when no channel is set", () => {
    expect(
      decideDevIdentity(
        { NODE_ENV: "production", SUPPORTPILOT_ALLOW_DEV_IDENTITY: "true" },
        { header: null, cookie: "   ", query: null },
      ),
    ).toEqual({ status: "absent" });
  });
});

describe("development identity route", () => {
  it("does not set a cookie when the flag is off", async () => {
    env.SUPPORTPILOT_ALLOW_DEV_IDENTITY = "false";
    env.NODE_ENV = "test";
    const response = await POST(identityRequest(ada));
    expect(response.status).toBe(404);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("does not set a cookie in production even when the flag is true", async () => {
    env.SUPPORTPILOT_ALLOW_DEV_IDENTITY = "true";
    env.NODE_ENV = "production";
    const response = await POST(identityRequest(ada));
    expect(response.status).toBe(404);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("sets an httpOnly cookie for a seeded user when the switch is on", async () => {
    env.SUPPORTPILOT_ALLOW_DEV_IDENTITY = "true";
    env.NODE_ENV = "test";
    const response = await POST(identityRequest(ada));
    expect(response.status).toBe(303);
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${DEV_USER_COOKIE}=${ada}`);
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie).not.toContain("password");
  });

  it("rejects another origin and a user id outside the seed", async () => {
    env.SUPPORTPILOT_ALLOW_DEV_IDENTITY = "true";
    env.NODE_ENV = "test";
    const crossOrigin = await POST(
      identityRequest(ada, "https://evil.example"),
    );
    expect(crossOrigin.status).toBe(403);
    expect(crossOrigin.headers.get("set-cookie")).toBeNull();

    const stranger = await POST(
      identityRequest("00000000-0000-4000-8000-000000000099"),
    );
    expect(stranger.status).toBe(403);
    expect(stranger.headers.get("set-cookie")).toBeNull();
  });
});

describe("isSameOrigin", () => {
  it("requires a matching Origin header", () => {
    expect(isSameOrigin(identityRequest(ada))).toBe(true);
    expect(isSameOrigin(identityRequest(ada, "https://evil.example"))).toBe(
      false,
    );
  });
});

function identityRequest(userId: string, origin = "http://localhost:3000") {
  return new Request("http://localhost:3000/api/dev-identity", {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ userId }),
  });
}
