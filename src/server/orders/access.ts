import type { OrderAccess, OrderLookup } from "@/server/orders/types";

/**
 * The lookup closure is registered only for an authenticated customer who
 * already has `order:read`. A knowledge manager or an anonymous caller does
 * not receive the function, even when one was passed in by mistake.
 */
export function orderAccessForActor(input: {
  kind: "customer" | "anonymous" | "knowledge_manager";
  permissions?: readonly string[];
  lookup?: OrderLookup;
}): OrderAccess {
  if (input.kind === "anonymous") {
    return { mode: "anonymous" };
  }
  if (input.kind !== "customer") {
    return { mode: "unregistered" };
  }
  if (!input.permissions?.includes("order:read") || !input.lookup) {
    return { mode: "unregistered" };
  }
  return { mode: "customer", lookup: input.lookup };
}
