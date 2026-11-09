import { z } from "zod";

import type { Permission } from "@/server/auth/permissions";
import { storedCitationSchema } from "@/server/conversations/schema";

import {
  ticketPriorities,
  ticketReasons,
  ticketStatuses,
} from "@/server/tickets/machine";

const replyBody = z.string().trim().min(1).max(4_000);

export const createTicketBodySchema = z
  .object({
    conversationId: z.uuid(),
    reason: z.literal("customer_requested_human"),
  })
  .strict();

export const ticketReplyBodySchema = z
  .object({
    body: replyBody,
    visibility: z.enum(["customer", "internal"]),
  })
  .strict();

const ticketReplyJson = z
  .object({
    id: z.uuid(),
    body: z.string(),
    createdAt: z.string(),
    authorUserId: z.uuid(),
  })
  .strict();

const ticketCore = {
  id: z.uuid(),
  conversationId: z.uuid(),
  requesterUserId: z.uuid(),
  reason: z.enum(ticketReasons),
  priority: z.enum(ticketPriorities),
  status: z.enum(ticketStatuses),
  assigneeUserId: z.uuid().nullable(),
  claimedAt: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  citations: z.array(storedCitationSchema),
  replies: z.array(ticketReplyJson),
};

export const customerTicketSchema = z.object(ticketCore).strict();

export const staffTicketSchema = customerTicketSchema
  .extend({
    notes: z.array(ticketReplyJson),
    conversation: z.array(
      z
        .object({
          id: z.uuid(),
          role: z.enum(["user", "assistant"]),
          body: z.string(),
          createdAt: z.string(),
        })
        .strict(),
    ),
  })
  .strict();

export const customerTicketListSchema = z
  .object({
    tickets: z.array(
      customerTicketSchema.omit({ replies: true, citations: true }),
    ),
  })
  .strict();

export const ticketSummarySchema = z
  .object({
    id: z.uuid(),
    status: z.enum(ticketStatuses),
    reason: z.enum(ticketReasons),
    priority: z.enum(ticketPriorities),
  })
  .strict();

export type CustomerTicket = z.infer<typeof customerTicketSchema>;
export type StaffTicket = z.infer<typeof staffTicketSchema>;
export type TicketSummary = z.infer<typeof ticketSummarySchema>;
export type TicketAudience = "customer" | "agent" | "queue";

export function ticketAudience(
  permissions: readonly Permission[],
): TicketAudience {
  if (permissions.includes("ticket:reply")) {
    return "agent";
  }
  if (
    permissions.includes("ticket:claim") ||
    permissions.includes("tenant:settings:manage")
  ) {
    return "queue";
  }
  return "customer";
}
