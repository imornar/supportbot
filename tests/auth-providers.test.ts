import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createTenantAccessHandler } from "@/app/api/tenants/[tenantId]/access/route";
import { ForbiddenError } from "@/server/auth/access";
import { authProviders } from "@/server/auth/providers";
import { users } from "@/server/db/schema";

describe("auth providers", () => {
  it("uses GitHub OAuth and no credentials provider", () => {
    const configured = authProviders.map((provider) =>
      provider({ clientId: "github-client", clientSecret: "github-secret" }),
    );
    expect(configured.map((provider) => provider.id)).toEqual(["github"]);
    expect(configured.map((provider) => provider.type)).toEqual(["oauth"]);
  });

  it("does not store a password column", () => {
    const columns = Object.keys(getTableColumns(users));
    expect(columns).not.toContain("password");
    expect(columns).not.toContain("passwordHash");
    expect(columns).toContain("authProvider");
    expect(columns).toContain("authSubject");
  });
});

describe("tenant access route", () => {
  it("asks requirePermission before reporting a grant", async () => {
    const tenantId = "11111111-1111-4111-8111-111111111111";
    const request = new Request(
      `http://localhost:3000/api/tenants/${tenantId}/access?permission=audit:read`,
    );
    const check = async () => ({
      userId: "10000000-0000-4000-8000-000000000001",
      tenantId,
      permissions: ["audit:read" as const],
    });
    const GET = createTenantAccessHandler(check);
    const response = await GET(request, {
      params: Promise.resolve({ tenantId }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      userId: "10000000-0000-4000-8000-000000000001",
      tenantId,
      permission: "audit:read",
    });
  });

  it("returns 400 when the permission name is missing and 403 when the check refuses", async () => {
    const tenantId = "11111111-1111-4111-8111-111111111111";
    const GET = createTenantAccessHandler(async () => {
      throw new ForbiddenError();
    });
    const missing = await GET(
      new Request(`http://localhost:3000/api/tenants/${tenantId}/access`),
      { params: Promise.resolve({ tenantId }) },
    );
    expect(missing.status).toBe(400);

    const refused = await GET(
      new Request(
        `http://localhost:3000/api/tenants/${tenantId}/access?permission=order:read`,
      ),
      { params: Promise.resolve({ tenantId }) },
    );
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: "forbidden" });
  });
});
