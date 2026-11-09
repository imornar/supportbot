import { describe, expect, it, vi } from "vitest";

import { ForbiddenError } from "@/server/auth/access";
import type { Permission } from "@/server/auth/permissions";
import { createTenantAdminHandlers } from "@/server/tenants/handlers";
import { createTicketHandlers } from "@/server/tickets/handlers";

const tenantId = "11111111-1111-4111-8111-111111111111";
const membershipId = "30000000-0000-4000-8000-000000000003";

describe("staff route permissions", () => {
  it("names tenant:user:manage and refuses before a query", async () => {
    await expectForbidden("tenant:user:manage", async (handlers) =>
      handlers.listMembers(
        request("GET", `/api/v1/tenants/${tenantId}/members`),
        {
          params: Promise.resolve({ tenantId }),
        },
      ),
    );
    await expectForbidden("tenant:user:manage", async (handlers) =>
      handlers.assignRole(
        request(
          "POST",
          `/api/v1/tenants/${tenantId}/members/${membershipId}/roles`,
          { role: "support_agent" },
        ),
        { params: Promise.resolve({ tenantId, membershipId }) },
      ),
    );
    await expectForbidden("tenant:user:manage", async (handlers) =>
      handlers.revokeRole(
        request(
          "DELETE",
          `/api/v1/tenants/${tenantId}/members/${membershipId}/roles/support_agent`,
        ),
        {
          params: Promise.resolve({
            tenantId,
            membershipId,
            role: "support_agent",
          }),
        },
      ),
    );
    await expectForbidden("tenant:user:manage", async (handlers) =>
      handlers.deactivate(
        request(
          "POST",
          `/api/v1/tenants/${tenantId}/members/${membershipId}/deactivate`,
        ),
        { params: Promise.resolve({ tenantId, membershipId }) },
      ),
    );
  });

  it("names tenant:settings:manage and refuses before a query", async () => {
    await expectForbidden("tenant:settings:manage", async (handlers) =>
      handlers.readSettings(
        request("GET", `/api/v1/tenants/${tenantId}/settings`),
        { params: Promise.resolve({ tenantId }) },
      ),
    );
    await expectForbidden("tenant:settings:manage", async (handlers) =>
      handlers.updateSettings(
        request("PATCH", `/api/v1/tenants/${tenantId}/settings`, {
          publicSupportName: "Harbor Desk",
        }),
        { params: Promise.resolve({ tenantId }) },
      ),
    );
  });

  it("names audit:read and refuses before a query", async () => {
    await expectForbidden("audit:read", async (handlers) =>
      handlers.listAudit(request("GET", `/api/v1/tenants/${tenantId}/audit`), {
        params: Promise.resolve({ tenantId }),
      }),
    );
  });

  it("names ticket:read for the queue and refuses before a query", async () => {
    const seen: Permission[] = [];
    const db = vi.fn(() => {
      throw new Error("database was touched");
    });
    const handlers = createTicketHandlers({
      authorize: async (_request, permission) => {
        seen.push(permission);
        throw new ForbiddenError();
      },
      db,
    });
    const response = await handlers.list(
      new Request(
        `http://localhost:3000/api/v1/tickets?tenantId=${tenantId}&status=open`,
      ),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
    expect(seen).toEqual(["ticket:read"]);
    expect(db).not.toHaveBeenCalled();
  });
});

async function expectForbidden(
  permission: Permission,
  run: (
    handlers: ReturnType<typeof createTenantAdminHandlers>,
  ) => Promise<Response>,
) {
  const seen: Permission[] = [];
  const db = vi.fn(() => {
    throw new Error("database was touched");
  });
  const handlers = createTenantAdminHandlers({
    authorize: async (_request, requested) => {
      seen.push(requested);
      throw new ForbiddenError();
    },
    db,
  });
  const response = await run(handlers);
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: "forbidden" });
  expect(seen).toEqual([permission]);
  expect(db).not.toHaveBeenCalled();
}

function request(method: string, path: string, body?: unknown): Request {
  return new Request(`http://localhost:3000${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}
