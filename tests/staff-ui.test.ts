import { describe, expect, it, vi } from "vitest";

import { permissions } from "@/server/auth/permissions";
import {
  createStaffSessionHandler,
  staffSessionFromMemberships,
} from "@/server/staff-ui/session";
import { presentAuditEvent } from "@/server/tenants/audit-list";
import { readApi, staffTicketSchema } from "@/staff-ui/api";
import {
  assignRoleRequest,
  deactivateMemberRequest,
  ingestionErrorCopy,
  messageFromErrorBody,
  permissionNames,
  requestErrorCopy,
  revokeRoleRequest,
  staffNav,
  uploadControlVisible,
  type StaffTenant,
} from "@/staff-ui/access";

const harbor = "11111111-1111-4111-8111-111111111111";
const northwind = "22222222-2222-4222-8222-222222222222";
const membershipId = "30000000-0000-4000-8000-000000000001";

describe("staff navigation", () => {
  it("keeps the client permission list aligned with the server", () => {
    expect(permissionNames).toEqual(permissions);
  });

  it("omits a customer and keeps staff roles", () => {
    const tenants = staffSessionFromMemberships([
      {
        tenantId: "33333333-3333-4333-8333-333333333333",
        name: "Public Desk",
        role: "customer",
      },
      { tenantId: harbor, name: "Harbor Goods", role: "knowledge_manager" },
      {
        tenantId: northwind,
        name: "Northwind Outfitters",
        role: "support_agent",
      },
    ]);
    expect(tenants.map((tenant) => tenant.name)).toEqual([
      "Harbor Goods",
      "Northwind Outfitters",
    ]);
    expect(tenants[0]?.permissions).toEqual([
      "document:read",
      "document:create",
      "document:update",
      "document:retire",
    ]);
    expect(tenants[1]?.permissions).toEqual([
      "ticket:read",
      "ticket:claim",
      "ticket:reply",
      "ticket:resolve",
    ]);
  });

  it("drops a tenant whose role name is unknown", () => {
    expect(
      staffSessionFromMemberships([
        { tenantId: harbor, name: "Harbor Goods", role: "superuser" },
      ]),
    ).toEqual([]);
  });

  it("hides upload, inbox, and admin from a customer permission set", () => {
    const customer: StaffTenant = {
      id: harbor,
      name: "Harbor Goods",
      permissions: [
        "conversation:read",
        "conversation:create",
        "order:read",
        "ticket:read",
      ],
    };
    expect(uploadControlVisible(customer)).toBe(false);
    expect(staffNav(customer)).toEqual([]);
    expect(uploadControlVisible(null)).toBe(false);
  });

  it("shows the knowledge link without an upload control for an admin", () => {
    const admin: StaffTenant = {
      id: harbor,
      name: "Harbor Goods",
      permissions: [
        "tenant:user:manage",
        "tenant:settings:manage",
        "audit:read",
        "document:read",
        "ticket:read",
      ],
    };
    expect(staffNav(admin).map((item) => item.label)).toEqual([
      "Knowledge",
      "Inbox",
      "Administration",
    ]);
    expect(uploadControlVisible(admin)).toBe(false);
  });
});

describe("staff error copy", () => {
  it("renders a fixed ingestion sentence and ignores raw failure text", () => {
    expect(ingestionErrorCopy("ready", null)).toBeNull();
    expect(ingestionErrorCopy("failed", "embedding_not_configured")).toBe(
      "Indexing is not configured.",
    );
    expect(
      ingestionErrorCopy("failed", "Error: sk-live\n    at indexChunks"),
    ).toBe("Indexing failed.");
  });

  it("maps known API codes and drops stacks or key-like strings", () => {
    expect(requestErrorCopy("last_admin")).toBe(
      "The last tenant admin must keep that role.",
    );
    expect(messageFromErrorBody('{"error":"last_admin"}')).toBe(
      "The last tenant admin must keep that role.",
    );
    expect(
      messageFromErrorBody(
        JSON.stringify({
          error: "Error: sk-live",
          stack: "Error: sk-live\n    at handler",
        }),
      ),
    ).toBe("The request failed.");
    expect(messageFromErrorBody("sk-live")).toBe("The request failed.");
  });
});

describe("staff role requests", () => {
  it("uses the step 12 member routes", () => {
    expect(assignRoleRequest(harbor, membershipId, "support_agent")).toEqual({
      url: `/api/v1/tenants/${harbor}/members/${membershipId}/roles`,
      method: "POST",
      body: { role: "support_agent" },
    });
    expect(revokeRoleRequest(harbor, membershipId, "tenant_admin")).toEqual({
      url: `/api/v1/tenants/${harbor}/members/${membershipId}/roles/tenant_admin`,
      method: "DELETE",
    });
    expect(deactivateMemberRequest(harbor, membershipId)).toEqual({
      url: `/api/v1/tenants/${harbor}/members/${membershipId}/deactivate`,
      method: "POST",
    });
  });
});

describe("audit list view", () => {
  it("keeps the actor, action, and target and drops other fields", () => {
    const row = {
      id: "50000000-0000-4000-8000-000000000001",
      action: "membership.role_revoke",
      targetType: "membership",
      targetId: membershipId,
      actorUserId: "10000000-0000-4000-8000-000000000001",
      createdAt: new Date("2026-11-09T12:00:00.000Z"),
      metadata: "sk-live",
    };
    const view = presentAuditEvent(row);
    expect(view).toEqual({
      id: "50000000-0000-4000-8000-000000000001",
      action: "membership.role_revoke",
      targetType: "membership",
      targetId: membershipId,
      actorUserId: "10000000-0000-4000-8000-000000000001",
      createdAt: "2026-11-09T12:00:00.000Z",
    });
  });
});

describe("staff session route", () => {
  it("refuses an anonymous caller before loading memberships", async () => {
    const memberships = vi.fn();
    const handler = createStaffSessionHandler({
      identify: async () => ({ status: "anonymous" }),
      memberships,
    });
    const response = await handler(
      new Request("http://localhost/api/v1/staff/session"),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
    expect(memberships).not.toHaveBeenCalled();
  });

  it("returns only staff tenants for the signed-in user", async () => {
    const handler = createStaffSessionHandler({
      identify: async () => ({
        status: "user",
        userId: "10000000-0000-4000-8000-000000000002",
      }),
      memberships: async () => [
        { tenantId: harbor, name: "Harbor Goods", role: "customer" },
        {
          tenantId: northwind,
          name: "Northwind Outfitters",
          role: "support_agent",
        },
      ],
    });
    const response = await handler(
      new Request("http://localhost/api/v1/staff/session"),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      tenants: [
        {
          id: northwind,
          name: "Northwind Outfitters",
          permissions: [
            "ticket:read",
            "ticket:claim",
            "ticket:reply",
            "ticket:resolve",
          ],
        },
      ],
    });
  });

  it("hides the database error", async () => {
    const handler = createStaffSessionHandler({
      identify: async () => ({
        status: "user",
        userId: "10000000-0000-4000-8000-000000000002",
      }),
      memberships: async () => {
        throw new Error("postgresql://secret");
      },
    });
    const response = await handler(
      new Request("http://localhost/api/v1/staff/session"),
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "staff_session_failed" });
  });
});

describe("staff ticket view", () => {
  it("rejects a ticket that omits the notes field", async () => {
    const result = await readApi(
      Response.json({
        id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        replies: [],
        notes: "hidden",
      }),
      staffTicketSchema,
    );
    expect(result).toEqual({ ok: false, message: "The request failed." });
  });
});
