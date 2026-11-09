import "server-only";

import { listAuditEvents } from "@/server/db/tenant-queries";
import type { TenantQueryClient } from "@/server/db/tenant-queries";

export type AuditEventView = {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  actorUserId: string;
  createdAt: string;
};

/**
 * The list is the actor, action, and target already stored for the tenant.
 * Extra columns on a row are dropped so the screen cannot render them.
 */
export function presentAuditEvent(row: {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  actorUserId: string;
  createdAt: Date;
}): AuditEventView {
  return {
    id: row.id,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    actorUserId: row.actorUserId,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listPermittedAuditEvents(
  db: TenantQueryClient,
  tenantId: string,
): Promise<{ events: AuditEventView[] }> {
  const rows = await listAuditEvents(db, tenantId);
  const events = rows.map((row) => presentAuditEvent(row));
  events.sort(
    (left, right) =>
      right.createdAt.localeCompare(left.createdAt) ||
      left.id.localeCompare(right.id),
  );
  return { events };
}
