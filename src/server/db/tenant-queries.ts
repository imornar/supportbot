import { eq } from "drizzle-orm";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from "drizzle-orm/node-postgres";
import type { PgTransaction } from "drizzle-orm/pg-core";

import * as schema from "@/server/db/schema";

const { auditEvents, tenantMemberships, users } = schema;

export type AppDatabase = NodePgDatabase<typeof schema>;

export type TenantQueryClient =
  | AppDatabase
  | PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >;

/**
 * Tenant id is a required argument. Filtering again in memory would hide a
 * missing SQL predicate, so these helpers do not.
 */
export async function listTenantMemberships(
  db: TenantQueryClient,
  tenantId: string,
) {
  return db
    .select({
      membershipId: tenantMemberships.id,
      tenantId: tenantMemberships.tenantId,
      userId: tenantMemberships.userId,
      email: users.email,
      status: tenantMemberships.status,
    })
    .from(tenantMemberships)
    .innerJoin(users, eq(users.id, tenantMemberships.userId))
    .where(eq(tenantMemberships.tenantId, tenantId));
}

export async function listAuditEvents(db: TenantQueryClient, tenantId: string) {
  return db
    .select({
      id: auditEvents.id,
      tenantId: auditEvents.tenantId,
      actorUserId: auditEvents.actorUserId,
      action: auditEvents.action,
      targetType: auditEvents.targetType,
      targetId: auditEvents.targetId,
      createdAt: auditEvents.createdAt,
    })
    .from(auditEvents)
    .where(eq(auditEvents.tenantId, tenantId))
    .orderBy(auditEvents.createdAt);
}
