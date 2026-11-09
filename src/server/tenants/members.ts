import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { roles, type Role } from "@/server/auth/permissions";
import { insertAuditEvent } from "@/server/db/audit";
import { roleAssignments, tenantMemberships, users } from "@/server/db/schema";
import type { TenantQueryClient } from "@/server/db/tenant-queries";

const memberSchema = z
  .object({
    membershipId: z.uuid(),
    userId: z.uuid(),
    displayName: z.string(),
    email: z.string(),
    status: z.enum(["active", "deactivated"]),
    roles: z.array(z.enum(roles)),
  })
  .strict();

export type TenantMember = z.infer<typeof memberSchema>;

export class TenantMemberError extends Error {
  readonly code: "not_found" | "last_admin" | "membership_inactive";

  constructor(code: "not_found" | "last_admin" | "membership_inactive") {
    super("Tenant membership request failed. Values are omitted.");
    this.name = "TenantMemberError";
    this.code = code;
  }
}

export async function listMembers(
  db: TenantQueryClient,
  tenantId: string,
): Promise<{ members: TenantMember[] }> {
  const memberships = await db
    .select({
      membershipId: tenantMemberships.id,
      userId: tenantMemberships.userId,
      displayName: users.displayName,
      email: users.email,
      status: tenantMemberships.status,
    })
    .from(tenantMemberships)
    .innerJoin(users, eq(users.id, tenantMemberships.userId))
    .where(eq(tenantMemberships.tenantId, tenantId))
    .orderBy(asc(users.email));
  const assigned = await db
    .select({
      membershipId: roleAssignments.membershipId,
      role: roleAssignments.role,
    })
    .from(roleAssignments)
    .where(eq(roleAssignments.tenantId, tenantId));
  const byMembership = new Map<string, Role[]>();
  for (const row of assigned) {
    const current = byMembership.get(row.membershipId) ?? [];
    current.push(row.role);
    byMembership.set(row.membershipId, current);
  }
  return {
    members: memberships.map((membership) =>
      memberSchema.parse({
        ...membership,
        roles: roles.filter((role) =>
          (byMembership.get(membership.membershipId) ?? []).includes(role),
        ),
      }),
    ),
  };
}

export async function assignRole(
  db: TenantQueryClient,
  actor: { tenantId: string; userId: string },
  membershipId: string,
  role: Role,
): Promise<TenantMember> {
  return db.transaction(async (tx) => {
    await lockMemberships(tx, actor.tenantId);
    const membership = await loadMembership(tx, actor.tenantId, membershipId);
    if (membership.status === "deactivated") {
      throw new TenantMemberError("membership_inactive");
    }
    const existing = membership.roles.includes(role);
    if (!existing) {
      await tx.insert(roleAssignments).values({
        tenantId: actor.tenantId,
        membershipId,
        role,
      });
      await insertAuditEvent(tx, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "membership.role_assign",
        targetType: "membership",
        targetId: membershipId,
      });
    }
    return reloadMember(tx, actor.tenantId, membershipId);
  });
}

export async function revokeRole(
  db: TenantQueryClient,
  actor: { tenantId: string; userId: string },
  membershipId: string,
  role: Role,
): Promise<TenantMember> {
  return db.transaction(async (tx) => {
    await lockMemberships(tx, actor.tenantId);
    const membership = await loadMembership(tx, actor.tenantId, membershipId);
    if (!membership.roles.includes(role)) {
      throw new TenantMemberError("not_found");
    }
    if (
      role === "tenant_admin" &&
      (await isLastActiveAdmin(tx, actor.tenantId, membershipId))
    ) {
      throw new TenantMemberError("last_admin");
    }
    await tx
      .delete(roleAssignments)
      .where(
        and(
          eq(roleAssignments.tenantId, actor.tenantId),
          eq(roleAssignments.membershipId, membershipId),
          eq(roleAssignments.role, role),
        ),
      );
    await insertAuditEvent(tx, {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "membership.role_revoke",
      targetType: "membership",
      targetId: membershipId,
    });
    return reloadMember(tx, actor.tenantId, membershipId);
  });
}

export async function deactivateMembership(
  db: TenantQueryClient,
  actor: { tenantId: string; userId: string },
  membershipId: string,
): Promise<TenantMember> {
  return db.transaction(async (tx) => {
    await lockMemberships(tx, actor.tenantId);
    const membership = await loadMembership(tx, actor.tenantId, membershipId);
    if (membership.status === "deactivated") {
      return membership;
    }
    if (
      membership.roles.includes("tenant_admin") &&
      (await isLastActiveAdmin(tx, actor.tenantId, membershipId))
    ) {
      throw new TenantMemberError("last_admin");
    }
    await tx
      .update(tenantMemberships)
      .set({ status: "deactivated", updatedAt: new Date() })
      .where(
        and(
          eq(tenantMemberships.id, membershipId),
          eq(tenantMemberships.tenantId, actor.tenantId),
        ),
      );
    await insertAuditEvent(tx, {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "membership.deactivate",
      targetType: "membership",
      targetId: membershipId,
    });
    return reloadMember(tx, actor.tenantId, membershipId);
  });
}

async function lockMemberships(db: TenantQueryClient, tenantId: string) {
  await db
    .select({ id: tenantMemberships.id })
    .from(tenantMemberships)
    .where(eq(tenantMemberships.tenantId, tenantId))
    .for("update");
}

async function isLastActiveAdmin(
  db: TenantQueryClient,
  tenantId: string,
  membershipId: string,
): Promise<boolean> {
  const admins = await db
    .select({ membershipId: roleAssignments.membershipId })
    .from(roleAssignments)
    .innerJoin(
      tenantMemberships,
      and(
        eq(tenantMemberships.id, roleAssignments.membershipId),
        eq(tenantMemberships.tenantId, roleAssignments.tenantId),
      ),
    )
    .where(
      and(
        eq(roleAssignments.tenantId, tenantId),
        eq(roleAssignments.role, "tenant_admin"),
        eq(tenantMemberships.status, "active"),
      ),
    );
  return admins.length === 1 && admins[0]?.membershipId === membershipId;
}

async function loadMembership(
  db: TenantQueryClient,
  tenantId: string,
  membershipId: string,
): Promise<TenantMember> {
  const listed = await listMembers(db, tenantId);
  const member = listed.members.find(
    (candidate) => candidate.membershipId === membershipId,
  );
  if (!member) {
    throw new TenantMemberError("not_found");
  }
  return member;
}

async function reloadMember(
  db: TenantQueryClient,
  tenantId: string,
  membershipId: string,
): Promise<TenantMember> {
  return loadMembership(db, tenantId, membershipId);
}
