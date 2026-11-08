import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closePool, getDb } from "@/server/db/client";
import {
  auditEvents,
  roleAssignments,
  tenantMemberships,
  tenants,
  users,
} from "@/server/db/schema";
import { insertDevelopmentSeed } from "@/server/db/seed";
import { seedTenants, seedUsers } from "@/server/db/seed-data";
import {
  listAuditEvents,
  listTenantMemberships,
} from "@/server/db/tenant-queries";
import type { TenantQueryClient } from "@/server/db/tenant-queries";

const databaseUrl = process.env.DATABASE_URL?.trim();
const rollback = new Error("rollback test transaction");

describe.skipIf(!databaseUrl)("tenant isolation", () => {
  afterAll(async () => {
    await closePool();
  });

  it("returns only the requested tenant from membership and audit queries", async () => {
    await withRollback(async (tx) => {
      const tenantA = randomUUID();
      const tenantB = randomUUID();
      const userA = randomUUID();
      const userB = randomUUID();
      const membershipA = randomUUID();
      const membershipB = randomUUID();
      const emailA = email("a");
      const emailB = email("b");

      await tx.insert(tenants).values([
        { id: tenantA, slug: slug("a"), name: "Tenant A" },
        { id: tenantB, slug: slug("b"), name: "Tenant B" },
      ]);
      await tx.insert(users).values([
        { id: userA, email: emailA, displayName: "Tenant A user" },
        { id: userB, email: emailB, displayName: "Tenant B user" },
      ]);
      await tx.insert(tenantMemberships).values([
        { id: membershipA, tenantId: tenantA, userId: userA },
        { id: membershipB, tenantId: tenantB, userId: userB },
      ]);
      await tx.insert(auditEvents).values([
        {
          tenantId: tenantA,
          actorUserId: userA,
          action: "tenant:settings:manage",
          targetType: "tenant",
          targetId: tenantA,
        },
        {
          tenantId: tenantB,
          actorUserId: userB,
          action: "tenant:settings:manage",
          targetType: "tenant",
          targetId: tenantB,
        },
      ]);

      const memberships = await listTenantMemberships(tx, tenantA);
      const otherTenant = await listTenantMemberships(tx, tenantB);
      const events = await listAuditEvents(tx, tenantA);

      expect(memberships.map((row) => row.email)).toEqual([emailA]);
      expect(otherTenant.map((row) => row.email)).toEqual([emailB]);
      expect(memberships.every((row) => row.tenantId === tenantA)).toBe(true);
      expect(events.map((row) => row.tenantId)).toEqual([tenantA]);
      expect(events.some((row) => row.targetId === tenantB)).toBe(false);
    });
  });

  it("rejects a second membership for the same user and tenant", async () => {
    await expect(
      getDb().transaction(async (tx) => {
        const tenantId = randomUUID();
        const userId = randomUUID();
        await tx
          .insert(tenants)
          .values({ id: tenantId, slug: slug("dup"), name: "Dup" });
        await tx.insert(users).values({
          id: userId,
          email: email("dup"),
          displayName: "Dup",
        });
        await tx.insert(tenantMemberships).values({ tenantId, userId });
        await tx.insert(tenantMemberships).values({ tenantId, userId });
      }),
    ).rejects.toThrow();
  });

  it("rejects a role assignment whose tenant does not match the membership", async () => {
    await expect(
      getDb().transaction(async (tx) => {
        const tenantA = randomUUID();
        const tenantB = randomUUID();
        const userId = randomUUID();
        const membershipId = randomUUID();
        await tx.insert(tenants).values([
          { id: tenantA, slug: slug("role-a"), name: "Role A" },
          { id: tenantB, slug: slug("role-b"), name: "Role B" },
        ]);
        await tx.insert(users).values({
          id: userId,
          email: email("role"),
          displayName: "Role",
        });
        await tx.insert(tenantMemberships).values({
          id: membershipId,
          tenantId: tenantA,
          userId,
        });
        await tx.insert(roleAssignments).values({
          tenantId: tenantB,
          membershipId,
          role: "customer",
        });
      }),
    ).rejects.toThrow();
  });

  it("seeds two tenants once, with no password column to fill", async () => {
    await withRollback(async (tx) => {
      await insertDevelopmentSeed(tx);
      await insertDevelopmentSeed(tx);

      const harbor = await listTenantMemberships(tx, seedTenants[0].id);
      const northwind = await listTenantMemberships(tx, seedTenants[1].id);
      const harborEmails = harbor.map((row) => row.email).sort();
      const northwindEmails = northwind.map((row) => row.email).sort();

      expect(harborEmails).toEqual(
        [
          "ada@harbor.example",
          "casey@harbor.example",
          "jordan@example.dev",
          "ken@harbor.example",
          "sam@harbor.example",
        ].sort(),
      );
      expect(northwindEmails).toEqual(
        [
          "jordan@example.dev",
          "nora@northwind.example",
          "pat@northwind.example",
        ].sort(),
      );
      expect(harborEmails).not.toContain("nora@northwind.example");
      expect(seedUsers.every((user) => !("password" in user))).toBe(true);

      const storedUsers = await tx
        .select({ email: users.email })
        .from(users)
        .where(eq(users.email, "ada@harbor.example"));
      expect(storedUsers).toEqual([{ email: "ada@harbor.example" }]);
    });
  });
});

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

function slug(label: string): string {
  return `t-${label}-${randomUUID().slice(0, 8)}`;
}

function email(label: string): string {
  return `${label}-${randomUUID().slice(0, 8)}@example.test`;
}
