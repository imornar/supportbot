import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { parseAuditEvent } from "@/server/db/audit";
import * as schema from "@/server/db/schema";
import {
  auditEvents,
  roleAssignments,
  tenantMemberships,
  tenants,
  users,
} from "@/server/db/schema";
import {
  seedMemberships,
  seedRoleAssignments,
  seedTenants,
  seedUsers,
} from "@/server/db/seed-data";
import { developmentSeedAllowed } from "@/server/db/seed-policy";
import type { TenantQueryClient } from "@/server/db/tenant-queries";

const seedRefused =
  "Refusing to seed. Development seed data is for a local database only. Values are omitted.";

export async function insertDevelopmentSeed(
  db: TenantQueryClient,
): Promise<void> {
  await db
    .insert(tenants)
    .values([...seedTenants])
    .onConflictDoNothing();
  await db
    .insert(users)
    .values([...seedUsers])
    .onConflictDoNothing();
  await db
    .insert(tenantMemberships)
    .values(
      seedMemberships.map((membership) => ({
        id: membership.id,
        tenantId: membership.tenantId,
        userId: membership.userId,
      })),
    )
    .onConflictDoNothing();
  await db
    .insert(roleAssignments)
    .values([...seedRoleAssignments])
    .onConflictDoNothing();

  for (const tenant of seedTenants) {
    const actor = seedMemberships.find(
      (membership) => membership.tenantId === tenant.id,
    );
    if (!actor) {
      throw new Error("Development seed is missing a tenant actor.");
    }
    const event = parseAuditEvent({
      tenantId: tenant.id,
      actorUserId: actor.userId,
      action: "dev.seed",
      targetType: "tenant",
      targetId: tenant.id,
    });
    await db
      .insert(auditEvents)
      .values({
        ...event,
        id:
          tenant.id === seedTenants[0].id
            ? "50000000-0000-4000-8000-000000000001"
            : "50000000-0000-4000-8000-000000000002",
      })
      .onConflictDoNothing();
  }
}

export async function seedDevelopmentDatabase(
  connectionString: string,
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  if (!developmentSeedAllowed(env)) {
    throw new Error(seedRefused);
  }

  const pool = new Pool({ connectionString, max: 1 });
  try {
    const db = drizzle({ client: pool, schema });
    await insertDevelopmentSeed(db);
  } finally {
    await pool.end();
  }
}
