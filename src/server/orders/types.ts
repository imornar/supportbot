import { z } from "zod";

export const orderStatuses = ["placed", "shipped", "delivered"] as const;

export type OrderStatus = (typeof orderStatuses)[number];

/**
 * Fields a customer may see. Internal notes and payment instruments are
 * columns on the row and are not part of this object.
 */
export const orderSummarySchema = z
  .object({
    id: z.uuid(),
    orderNumber: z.string().regex(/^[0-9]{1,12}$/),
    status: z.enum(orderStatuses),
    placedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    summary: z.string().min(1).max(500),
  })
  .strict();

export type OrderSummary = z.infer<typeof orderSummarySchema>;

export type OrderLookupResult =
  | { status: "found"; order: OrderSummary }
  | { status: "refused" }
  | { status: "none" };

export type OrderLookup = (
  modelOutput: unknown,
  question: string,
) => Promise<OrderLookupResult>;

export type OrderAccess =
  | { mode: "customer"; lookup: OrderLookup }
  | { mode: "anonymous" }
  | { mode: "unregistered" };
