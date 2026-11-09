import "server-only";

import { eq } from "drizzle-orm";

import { insertAuditEvent } from "@/server/db/audit";
import { tenants } from "@/server/db/schema";
import type { TenantQueryClient } from "@/server/db/tenant-queries";
import {
  defaultSupportName,
  isPublicSupportName,
} from "@/server/workflow/decision";

export class TenantSettingsError extends Error {
  readonly code: "not_found";

  constructor(code: "not_found") {
    super("Tenant settings request failed. Values are omitted.");
    this.name = "TenantSettingsError";
    this.code = code;
  }
}

export async function loadPublicSupportName(
  db: TenantQueryClient,
  tenantId: string,
): Promise<string> {
  const [row] = await db
    .select({ publicSupportName: tenants.publicSupportName })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  if (!row || !isPublicSupportName(row.publicSupportName)) {
    return defaultSupportName;
  }
  return row.publicSupportName;
}

export async function readTenantSettings(
  db: TenantQueryClient,
  tenantId: string,
): Promise<{ publicSupportName: string }> {
  const publicSupportName = await loadPublicSupportName(db, tenantId);
  const [row] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  if (!row) {
    throw new TenantSettingsError("not_found");
  }
  return { publicSupportName };
}

export async function updatePublicSupportName(
  db: TenantQueryClient,
  actor: { tenantId: string; userId: string },
  publicSupportName: string,
): Promise<{ publicSupportName: string }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ publicSupportName: tenants.publicSupportName })
      .from(tenants)
      .where(eq(tenants.id, actor.tenantId))
      .for("update");
    if (!row) {
      throw new TenantSettingsError("not_found");
    }
    if (row.publicSupportName !== publicSupportName) {
      await tx
        .update(tenants)
        .set({ publicSupportName, updatedAt: new Date() })
        .where(eq(tenants.id, actor.tenantId));
      await insertAuditEvent(tx, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "tenant.settings",
        targetType: "tenant",
        targetId: actor.tenantId,
      });
    }
    return { publicSupportName };
  });
}
