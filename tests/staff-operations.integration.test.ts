import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import type { AccessDeps } from "@/server/auth/access";
import { DEV_USER_HEADER } from "@/server/auth/dev-identity";
import { loadMembershipAccess } from "@/server/auth/membership-access";
import { createConversationHandlers } from "@/server/conversations/handlers";
import { closePool, getDb } from "@/server/db/client";
import { auditEvents } from "@/server/db/schema";
import { seedMemberships, seedTenants, seedUsers } from "@/server/db/seed-data";
import { insertDevelopmentSeed } from "@/server/db/seed";
import type { TenantQueryClient } from "@/server/db/tenant-queries";
import { fakeEmbedder } from "@/server/documents/embed";
import { createTenantAdminHandlers } from "@/server/tenants/handlers";
import { createTicketHandlers } from "@/server/tickets/handlers";
import { humanEscalationMessageFor } from "@/server/workflow/decision";

const databaseUrl = process.env.DATABASE_URL?.trim();
const rollback = new Error("rollback staff test");
const harbor = seedTenants[0].id;
const northwind = seedTenants[1].id;
const ada = seedUsers[0].id;
const ken = seedUsers[1].id;
const sam = seedUsers[2].id;
const casey = seedUsers[3].id;
const nora = seedUsers[4].id;
const jordan = seedUsers[6].id;
const adaMembership = seedMemberships[0].id;
const kenMembership = seedMemberships[1].id;
const samMembership = seedMemberships[2].id;
const jordanHarborMembership = seedMemberships[6].id;

describe.skipIf(!databaseUrl)("staff operations", () => {
  afterAll(async () => {
    await closePool();
  });

  it("keeps membership changes inside the caller's tenant", async () => {
    await withRollback(async (tx) => {
      await insertDevelopmentSeed(tx);
      const admin = createTenantAdminHandlers({
        db: () => tx,
        accessDeps: accessFor(tx),
      });
      const tickets = createTicketHandlers({
        db: () => tx,
        accessDeps: accessFor(tx),
      });

      const listed = await admin.listMembers(
        adminRequest("GET", membersPath(harbor), ada),
        {
          params: Promise.resolve({ tenantId: harbor }),
        },
      );
      expect(listed.status).toBe(200);
      const members = (await listed.json()) as {
        members: Array<{ email: string; userId: string; roles: string[] }>;
      };
      expect(members.members.map((member) => member.userId)).toContain(sam);
      expect(JSON.stringify(members)).not.toContain("nora@northwind.example");
      expect(JSON.stringify(members)).not.toContain("authSubject");

      const agentForbidden = await admin.listMembers(
        adminRequest("GET", membersPath(harbor), sam),
        { params: Promise.resolve({ tenantId: harbor }) },
      );
      expect(agentForbidden.status).toBe(403);

      const otherTenant = await admin.listMembers(
        adminRequest("GET", membersPath(harbor), nora),
        { params: Promise.resolve({ tenantId: harbor }) },
      );
      expect(otherTenant.status).toBe(403);

      const crossed = await admin.deactivate(
        adminRequest(
          "POST",
          `${membersPath(northwind)}/${samMembership}/deactivate`,
          nora,
        ),
        {
          params: Promise.resolve({
            tenantId: northwind,
            membershipId: samMembership,
          }),
        },
      );
      expect(crossed.status).toBe(404);

      const keepAdmin = await admin.revokeRole(
        adminRequest(
          "DELETE",
          `${membersPath(harbor)}/${adaMembership}/roles/tenant_admin`,
          ada,
        ),
        {
          params: Promise.resolve({
            tenantId: harbor,
            membershipId: adaMembership,
            role: "tenant_admin",
          }),
        },
      );
      expect(keepAdmin.status).toBe(409);
      expect(await keepAdmin.json()).toEqual({ error: "last_admin" });

      const keepByDeactivate = await admin.deactivate(
        adminRequest(
          "POST",
          `${membersPath(harbor)}/${adaMembership}/deactivate`,
          ada,
        ),
        {
          params: Promise.resolve({
            tenantId: harbor,
            membershipId: adaMembership,
          }),
        },
      );
      expect(keepByDeactivate.status).toBe(409);

      const secondAdmin = await admin.assignRole(
        adminRequest(
          "POST",
          `${membersPath(harbor)}/${kenMembership}/roles`,
          ada,
          { role: "tenant_admin" },
        ),
        {
          params: Promise.resolve({
            tenantId: harbor,
            membershipId: kenMembership,
          }),
        },
      );
      expect(secondAdmin.status).toBe(200);
      expect(
        ((await secondAdmin.json()) as { member: { roles: string[] } }).member
          .roles,
      ).toEqual(["knowledge_manager", "tenant_admin"]);

      const steppedDown = await admin.revokeRole(
        adminRequest(
          "DELETE",
          `${membersPath(harbor)}/${adaMembership}/roles/tenant_admin`,
          ada,
        ),
        {
          params: Promise.resolve({
            tenantId: harbor,
            membershipId: adaMembership,
            role: "tenant_admin",
          }),
        },
      );
      expect(steppedDown.status).toBe(200);

      const formerAdmin = await admin.listMembers(
        adminRequest("GET", membersPath(harbor), ada),
        { params: Promise.resolve({ tenantId: harbor }) },
      );
      expect(formerAdmin.status).toBe(403);

      const lastRemaining = await admin.revokeRole(
        adminRequest(
          "DELETE",
          `${membersPath(harbor)}/${kenMembership}/roles/tenant_admin`,
          ken,
        ),
        {
          params: Promise.resolve({
            tenantId: harbor,
            membershipId: kenMembership,
            role: "tenant_admin",
          }),
        },
      );
      expect(lastRemaining.status).toBe(409);

      const before = await tickets.list(ticketRequest(sam, harbor));
      expect(before.status).toBe(200);

      const revoked = await admin.revokeRole(
        adminRequest(
          "DELETE",
          `${membersPath(harbor)}/${samMembership}/roles/support_agent`,
          ken,
        ),
        {
          params: Promise.resolve({
            tenantId: harbor,
            membershipId: samMembership,
            role: "support_agent",
          }),
        },
      );
      expect(revoked.status).toBe(200);
      const afterRevoke = await tickets.list(ticketRequest(sam, harbor));
      expect(afterRevoke.status).toBe(403);

      const restored = await admin.assignRole(
        adminRequest(
          "POST",
          `${membersPath(harbor)}/${samMembership}/roles`,
          ken,
          { role: "support_agent" },
        ),
        {
          params: Promise.resolve({
            tenantId: harbor,
            membershipId: samMembership,
          }),
        },
      );
      expect(restored.status).toBe(200);
      expect((await tickets.list(ticketRequest(sam, harbor))).status).toBe(200);

      const deactivated = await admin.deactivate(
        adminRequest(
          "POST",
          `${membersPath(harbor)}/${samMembership}/deactivate`,
          ken,
        ),
        {
          params: Promise.resolve({
            tenantId: harbor,
            membershipId: samMembership,
          }),
        },
      );
      expect(deactivated.status).toBe(200);
      expect(
        ((await deactivated.json()) as { member: { status: string } }).member
          .status,
      ).toBe("deactivated");
      expect((await tickets.list(ticketRequest(sam, harbor))).status).toBe(403);

      const assignInactive = await admin.assignRole(
        adminRequest(
          "POST",
          `${membersPath(harbor)}/${samMembership}/roles`,
          ken,
          { role: "support_agent" },
        ),
        {
          params: Promise.resolve({
            tenantId: harbor,
            membershipId: samMembership,
          }),
        },
      );
      expect(assignInactive.status).toBe(409);
      expect(await assignInactive.json()).toEqual({
        error: "membership_inactive",
      });

      const otherMembership = await admin.deactivate(
        adminRequest(
          "POST",
          `${membersPath(harbor)}/${jordanHarborMembership}/deactivate`,
          ken,
        ),
        {
          params: Promise.resolve({
            tenantId: harbor,
            membershipId: jordanHarborMembership,
          }),
        },
      );
      expect(otherMembership.status).toBe(200);
      expect((await tickets.list(ticketRequest(jordan, harbor))).status).toBe(
        403,
      );
      expect(
        (await tickets.list(ticketRequest(jordan, northwind))).status,
      ).toBe(200);

      const actions = await tx
        .select({ action: auditEvents.action, targetId: auditEvents.targetId })
        .from(auditEvents)
        .where(eq(auditEvents.tenantId, harbor));
      expect(actions.map((row) => row.action)).toEqual(
        expect.arrayContaining([
          "membership.role_assign",
          "membership.role_revoke",
          "membership.deactivate",
        ]),
      );
      expect(JSON.stringify(actions)).not.toContain("sam@harbor.example");
    });
  });

  it("uses the public support name in the next escalation", async () => {
    await withRollback(async (tx) => {
      await insertDevelopmentSeed(tx);
      const admin = createTenantAdminHandlers({
        db: () => tx,
        accessDeps: accessFor(tx),
      });
      const agentForbidden = await admin.updateSettings(
        adminRequest("PATCH", settingsPath(harbor), sam, {
          publicSupportName: "Harbor Desk",
        }),
        { params: Promise.resolve({ tenantId: harbor }) },
      );
      expect(agentForbidden.status).toBe(403);

      const otherTenant = await admin.updateSettings(
        adminRequest("PATCH", settingsPath(harbor), nora, {
          publicSupportName: "Harbor Desk",
        }),
        { params: Promise.resolve({ tenantId: harbor }) },
      );
      expect(otherTenant.status).toBe(403);

      const invalid = await admin.updateSettings(
        adminRequest("PATCH", settingsPath(harbor), ada, {
          publicSupportName: "Harbor Desk!",
        }),
        { params: Promise.resolve({ tenantId: harbor }) },
      );
      expect(invalid.status).toBe(400);

      const updated = await admin.updateSettings(
        adminRequest("PATCH", settingsPath(harbor), ada, {
          publicSupportName: "Harbor Desk",
        }),
        { params: Promise.resolve({ tenantId: harbor }) },
      );
      expect(updated.status).toBe(200);
      const again = await admin.updateSettings(
        adminRequest("PATCH", settingsPath(harbor), ada, {
          publicSupportName: "Harbor Desk",
        }),
        { params: Promise.resolve({ tenantId: harbor }) },
      );
      expect(again.status).toBe(200);

      const settings = await admin.readSettings(
        adminRequest("GET", settingsPath(harbor), ada),
        { params: Promise.resolve({ tenantId: harbor }) },
      );
      expect(await settings.json()).toEqual({
        publicSupportName: "Harbor Desk",
      });

      const conversations = createConversationHandlers({
        db: () => tx,
        embedder: () => fakeEmbedder(),
        chat: () => ({
          model: "fixture-model",
          complete: async () => {
            throw new Error("model should not be called");
          },
        }),
        retrievalSettings: () => ({ topK: 5, similarityThreshold: 0.3 }),
        now: () => new Date("2026-11-09T12:00:00.000Z"),
        env: {
          NODE_ENV: "test",
          SUPPORTPILOT_ALLOW_DEV_IDENTITY: "true",
          SUPPORTPILOT_PUBLIC_TENANT_SLUG: "harbor",
          SUPPORTPILOT_RATE_LIMIT_PER_MINUTE: "10",
        },
        accessDeps: accessFor(tx),
      });
      const created = await conversations.post(
        messageRequest(casey, harbor, "Please talk to a human"),
      );
      expect(created.status).toBe(201);
      const body = (await created.json()) as {
        messages: Array<{ body: string }>;
      };
      expect(body.messages[1]?.body).toBe(
        humanEscalationMessageFor("Harbor Desk"),
      );
      expect(body.messages[1]?.body).not.toMatch(/\bhas accepted\b/);

      const events = await tx
        .select({ action: auditEvents.action })
        .from(auditEvents)
        .where(eq(auditEvents.tenantId, harbor));
      expect(
        events.filter((event) => event.action === "tenant.settings"),
      ).toHaveLength(1);
      expect(JSON.stringify(events)).not.toContain("Harbor Desk");
    });
  });
});

function membersPath(tenantId: string): string {
  return `/api/v1/tenants/${tenantId}/members`;
}

function settingsPath(tenantId: string): string {
  return `/api/v1/tenants/${tenantId}/settings`;
}

function accessFor(tx: TenantQueryClient): AccessDeps {
  return {
    env: {
      NODE_ENV: "test",
      SUPPORTPILOT_ALLOW_DEV_IDENTITY: "true",
    },
    readSession: async () => null,
    findUserBySubject: async () => null,
    findMembership: (userId, tenantId) =>
      loadMembershipAccess(tx, userId, tenantId),
  };
}

function adminRequest(
  method: string,
  path: string,
  userId: string,
  body?: unknown,
): Request {
  return new Request(`http://localhost:3000${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      [DEV_USER_HEADER]: userId,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function ticketRequest(userId: string, tenantId: string): Request {
  const url = new URL("http://localhost:3000/api/v1/tickets");
  url.searchParams.set("tenantId", tenantId);
  return new Request(url, {
    headers: { [DEV_USER_HEADER]: userId },
  });
}

function messageRequest(
  userId: string,
  tenantId: string,
  question: string,
): Request {
  const url = new URL("http://localhost:3000/api/v1/support/messages");
  url.searchParams.set("tenantId", tenantId);
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": randomUUID(),
      [DEV_USER_HEADER]: userId,
    },
    body: JSON.stringify({ question }),
  });
}

async function withRollback(
  run: (tx: TenantQueryClient) => Promise<void>,
): Promise<void> {
  try {
    await getDb().transaction(async (tx) => {
      await run(tx);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) {
      throw error;
    }
  }
}
