import { describe, expect, it, vi } from "vitest";
import type { JWT } from "next-auth/jwt";
import {
  DevIdentityRejectedError,
  ForbiddenError,
  requirePermission,
  type AccessDeps,
} from "@/server/auth/access";
import { sessionToken } from "@/server/auth/config";
import {
  DEV_USER_COOKIE,
  DEV_USER_HEADER,
  DEV_USER_QUERY,
} from "@/server/auth/dev-identity";
import { seedMemberships, seedTenants, seedUsers } from "@/server/db/seed-data";

const ada = seedUsers[0];
const casey = seedUsers[3];
const jordan = seedUsers[6];
const harbor = seedTenants[0].id;
const northwind = seedTenants[1].id;
const plantedToken = "ghp-planted-access-token";

describe("requirePermission", () => {
  it("allows a permission the member holds and refuses one they do not", async () => {
    const deps = fakeDeps();
    await expect(
      requirePermission(request(), "audit:read", { tenantId: harbor }, deps),
    ).resolves.toMatchObject({ userId: ada.id, tenantId: harbor });
    await expect(
      requirePermission(request(), "order:read", { tenantId: harbor }, deps),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses a tenant the user does not belong to", async () => {
    const deps = fakeDeps();
    await expect(
      requirePermission(request(), "audit:read", { tenantId: northwind }, deps),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(deps.findMembership).toHaveBeenCalledWith(ada.id, northwind);
  });

  it("uses the membership in the resource tenant", async () => {
    const deps = fakeDeps({ userId: jordan.id });
    await expect(
      requirePermission(request(), "order:read", { tenantId: harbor }, deps),
    ).resolves.toMatchObject({ userId: jordan.id, tenantId: harbor });
    await expect(
      requirePermission(request(), "order:read", { tenantId: northwind }, deps),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      requirePermission(
        request(),
        "ticket:claim",
        { tenantId: northwind },
        deps,
      ),
    ).resolves.toMatchObject({ userId: jordan.id, tenantId: northwind });
  });

  it("reads roles on each check, so a role change applies without a new session", async () => {
    let roles = ["customer"];
    const deps = fakeDeps({
      userId: casey.id,
      findMembership: async () => ({ roles: [...roles] }),
    });
    await expect(
      requirePermission(request(), "order:read", { tenantId: harbor }, deps),
    ).resolves.toMatchObject({ userId: casey.id });
    roles = ["knowledge_manager"];
    await expect(
      requirePermission(request(), "order:read", { tenantId: harbor }, deps),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      requirePermission(
        request(),
        "document:create",
        { tenantId: harbor },
        deps,
      ),
    ).resolves.toMatchObject({ userId: casey.id });
  });

  it("rejects a development identity header in production before any lookup", async () => {
    const deps = fakeDeps({
      env: {
        NODE_ENV: "production",
        SUPPORTPILOT_ALLOW_DEV_IDENTITY: "true",
      },
      session: { provider: "github", subject: "real-subject" },
      userId: "real-user",
    });
    await expect(
      requirePermission(
        request({ header: ada.id }),
        "audit:read",
        { tenantId: harbor },
        deps,
      ),
    ).rejects.toBeInstanceOf(DevIdentityRejectedError);
    expect(deps.findMembership).not.toHaveBeenCalled();
    expect(deps.readSession).not.toHaveBeenCalled();
    expect(deps.findUserBySubject).not.toHaveBeenCalled();
  });

  it.each([{ cookie: ada.id }, { query: ada.id }])(
    "rejects a development identity signal when the flag is off",
    async (signal) => {
      const deps = fakeDeps({
        env: {
          NODE_ENV: "development",
          SUPPORTPILOT_ALLOW_DEV_IDENTITY: "false",
        },
      });
      await expect(
        requirePermission(
          request(signal),
          "audit:read",
          { tenantId: harbor },
          deps,
        ),
      ).rejects.toBeInstanceOf(DevIdentityRejectedError);
      expect(deps.findMembership).not.toHaveBeenCalled();
    },
  );

  it("uses the seeded development user and does not consult the session", async () => {
    const deps = fakeDeps({
      env: { NODE_ENV: "test", SUPPORTPILOT_ALLOW_DEV_IDENTITY: "true" },
      session: { provider: "github", subject: "someone-else" },
      userId: "session-user",
    });
    await expect(
      requirePermission(
        request({ header: casey.id }),
        "order:read",
        { tenantId: harbor },
        deps,
      ),
    ).resolves.toMatchObject({ userId: casey.id });
    expect(deps.readSession).not.toHaveBeenCalled();
  });
});

describe("session token", () => {
  it("keeps the provider subject and drops email and the access token", () => {
    const token = sessionToken(
      {
        email: "ada@harbor.example",
        name: "Ada",
        access_token: plantedToken,
      } as JWT,
      {
        provider: "github",
        providerAccountId: "44",
      },
    );
    expect(token).toEqual({ authProvider: "github", authSubject: "44" });
    expect(JSON.stringify(token)).not.toContain(plantedToken);
    expect(JSON.stringify(token)).not.toContain("ada@harbor.example");
  });
});

function request(
  signal: { header?: string; cookie?: string; query?: string } = {},
) {
  const url = new URL("http://localhost:3000/api/tenants/example/access");
  if (signal.query) {
    url.searchParams.set(DEV_USER_QUERY, signal.query);
  }
  const headers = new Headers();
  if (signal.header) {
    headers.set(DEV_USER_HEADER, signal.header);
  }
  if (signal.cookie) {
    headers.set("cookie", `${DEV_USER_COOKIE}=${signal.cookie}`);
  }
  return new Request(url, { headers });
}

function fakeDeps(
  options: {
    env?: Record<string, string | undefined>;
    userId?: string;
    session?: { provider: string; subject: string } | null;
    findMembership?: AccessDeps["findMembership"];
  } = {},
): AccessDeps & {
  findMembership: ReturnType<typeof vi.fn<AccessDeps["findMembership"]>>;
  readSession: ReturnType<typeof vi.fn<AccessDeps["readSession"]>>;
  findUserBySubject: ReturnType<typeof vi.fn<AccessDeps["findUserBySubject"]>>;
} {
  const userId = options.userId ?? ada.id;
  const findMembership = vi.fn<AccessDeps["findMembership"]>(
    options.findMembership ??
      (async (actorId, tenantId) => {
        const membership = seedMemberships.find(
          (row) => row.userId === actorId && row.tenantId === tenantId,
        );
        return membership ? { roles: membership.roles } : null;
      }),
  );
  return {
    env: options.env ?? {
      NODE_ENV: "test",
      SUPPORTPILOT_ALLOW_DEV_IDENTITY: "false",
    },
    readSession: vi.fn<AccessDeps["readSession"]>(async () =>
      options.session === undefined
        ? { provider: "github", subject: "subject" }
        : options.session,
    ),
    findUserBySubject: vi.fn<AccessDeps["findUserBySubject"]>(async () => ({
      userId,
    })),
    findMembership,
  };
}
