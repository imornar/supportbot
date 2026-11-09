import "server-only";

import { and, eq } from "drizzle-orm";

import { insertAuditEvent } from "@/server/db/audit";
import { customers, orders } from "@/server/db/schema";
import type { TenantQueryClient } from "@/server/db/tenant-queries";
import { resolveOrderNumber } from "@/server/orders/request";
import {
  orderSummarySchema,
  type OrderLookup,
  type OrderLookupResult,
} from "@/server/orders/types";

const refusedAction = "order.lookup.refused";

type SessionCustomer = {
  tenantId: string;
  userId: string;
};

/**
 * Read one order for the session customer inside the session tenant.
 * This is a fixed query, not SQL written by the model. The select list is
 * the allowlist. Internal notes and payment instruments are not columns here.
 */
export async function lookupOwnedOrder(
  db: TenantQueryClient,
  input: SessionCustomer & { orderNumber: string },
): Promise<OrderLookupResult> {
  const [owned] = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      status: orders.status,
      placedOn: orders.placedOn,
      summary: orders.summary,
    })
    .from(orders)
    .innerJoin(
      customers,
      and(
        eq(customers.id, orders.customerId),
        eq(customers.tenantId, orders.tenantId),
      ),
    )
    .where(
      and(
        eq(orders.tenantId, input.tenantId),
        eq(customers.tenantId, input.tenantId),
        eq(customers.userId, input.userId),
        eq(orders.orderNumber, input.orderNumber),
      ),
    )
    .limit(1);

  if (owned) {
    const parsed = orderSummarySchema.safeParse(owned);
    if (!parsed.success) {
      return refuse(db, input, null);
    }
    return { status: "found", order: parsed.data };
  }

  const [otherInTenant] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        eq(orders.tenantId, input.tenantId),
        eq(orders.orderNumber, input.orderNumber),
      ),
    )
    .limit(1);

  return refuse(db, input, otherInTenant?.id ?? null);
}

/**
 * The model output may include `customerId`. This function does not take a
 * customer id argument. The session user is the only owner it will match.
 * Zero or many order numbers return nothing and do not list rows.
 */
export async function readModelOrder(
  db: TenantQueryClient,
  session: SessionCustomer,
  modelOutput: unknown,
  question: string,
): Promise<OrderLookupResult> {
  const orderNumber = resolveOrderNumber(question, modelOutput);
  if (!orderNumber) {
    return { status: "none" };
  }
  return lookupOwnedOrder(db, { ...session, orderNumber });
}

export function createSessionOrderLookup(
  db: TenantQueryClient,
  session: SessionCustomer,
): OrderLookup {
  return (modelOutput, question) =>
    readModelOrder(db, session, modelOutput, question);
}

async function refuse(
  db: TenantQueryClient,
  input: SessionCustomer,
  orderId: string | null,
): Promise<{ status: "refused" }> {
  const [customer] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(
      and(
        eq(customers.tenantId, input.tenantId),
        eq(customers.userId, input.userId),
      ),
    )
    .limit(1);

  await insertAuditEvent(db, {
    tenantId: input.tenantId,
    actorUserId: input.userId,
    action: refusedAction,
    targetType: orderId ? "order" : customer ? "customer" : "user",
    targetId: orderId ?? customer?.id ?? input.userId,
  });
  return { status: "refused" };
}
