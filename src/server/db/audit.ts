import { z } from "zod";

import { auditEvents } from "@/server/db/schema";
import type { TenantQueryClient } from "@/server/db/tenant-queries";

const auditEventError =
  "Invalid audit event. The record accepts actor, tenant, action, and target only. Values are omitted.";

export const auditEventInput = z
  .object({
    tenantId: z.uuid(),
    actorUserId: z.uuid(),
    action: z.string().regex(/^[a-z0-9_.:]{1,64}$/),
    targetType: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    targetId: z.uuid(),
  })
  .strict();

export type AuditEventInput = z.infer<typeof auditEventInput>;

export function parseAuditEvent(input: unknown): AuditEventInput {
  const parsed = auditEventInput.safeParse(input);
  if (!parsed.success) {
    throw new Error(auditEventError);
  }
  return parsed.data;
}

export async function insertAuditEvent(
  db: TenantQueryClient,
  input: unknown,
): Promise<{ id: string }> {
  const event = parseAuditEvent(input);
  const [row] = await db
    .insert(auditEvents)
    .values(event)
    .returning({ id: auditEvents.id });
  if (!row) {
    throw new Error("Audit event was not stored.");
  }
  return row;
}
