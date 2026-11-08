import "server-only";

import { and, eq } from "drizzle-orm";

import type { Role } from "@/server/auth/permissions";
import { roleAssignments, tenantMemberships } from "@/server/db/schema";
import type { TenantQueryClient } from "@/server/db/tenant-queries";

/**
 * Active membership for one user in one tenant. The tenant id is a required
 * filter, so a membership in another tenant cannot satisfy the check.
 */
export async function loadMembershipAccess(
  db: TenantQueryClient,
  userId: string,
  tenantId: string,
): Promise<{ roles: Role[] } | null> {
  const rows = await db
    .select({
      role: roleAssignments.role,
    })
    .from(tenantMemberships)
    .leftJoin(
      roleAssignments,
      and(
        eq(roleAssignments.membershipId, tenantMemberships.id),
        eq(roleAssignments.tenantId, tenantMemberships.tenantId),
      ),
    )
    .where(
      and(
        eq(tenantMemberships.userId, userId),
        eq(tenantMemberships.tenantId, tenantId),
        eq(tenantMemberships.status, "active"),
      ),
    );

  if (rows.length === 0) {
    return null;
  }

  return {
    roles: rows.flatMap((row) => (row.role ? [row.role] : [])),
  };
}
