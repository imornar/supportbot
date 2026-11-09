import "server-only";

/**
 * Status machine for one ticket.
 *
 * - create -> open
 * - claim: open or reopened -> assigned. The same agent can claim again
 *   without a change. Another agent gets `ticket_held`.
 * - customer-visible reply: the holder only, and assigned -> in_progress.
 *   An internal note does not change status.
 * - resolve: the holder only, from assigned or in_progress -> resolved.
 * - reopen: any agent with `ticket:resolve`, resolved -> reopened. The
 *   previous assignee is cleared. `closed` has no transition.
 *
 * Priority is not a transition. It is fixed from the reason.
 */

export const ticketStatuses = [
  "open",
  "assigned",
  "in_progress",
  "resolved",
  "reopened",
  "closed",
] as const;

export const ticketPriorities = ["low", "normal", "high"] as const;

export const ticketReasons = [
  "customer_requested_human",
  "insufficient_evidence",
  "conflicting_sources",
  "repeated_attempts",
  "sensitive_request",
  "business_tool_unavailable",
  "workflow_failure",
] as const;

export type TicketStatus = (typeof ticketStatuses)[number];
export type TicketPriority = (typeof ticketPriorities)[number];
export type TicketReason = (typeof ticketReasons)[number];

export type TicketFailure = "illegal_transition" | "ticket_held";

export type TicketSnapshot = {
  status: TicketStatus;
  assigneeUserId: string | null;
};

const highPriority = new Set<TicketReason>([
  "sensitive_request",
  "conflicting_sources",
  "workflow_failure",
]);

const lowPriority = new Set<TicketReason>(["insufficient_evidence"]);

export function priorityForReason(reason: TicketReason): TicketPriority {
  if (highPriority.has(reason)) {
    return "high";
  }
  if (lowPriority.has(reason)) {
    return "low";
  }
  return "normal";
}

export function claimTransition(
  ticket: TicketSnapshot,
  actorUserId: string,
):
  | { ok: true; kind: "unchanged" }
  | { ok: true; kind: "claim" }
  | { ok: false; code: TicketFailure } {
  const held = ticket.status === "assigned" || ticket.status === "in_progress";
  if (held && ticket.assigneeUserId === actorUserId) {
    return { ok: true, kind: "unchanged" };
  }
  if (held && ticket.assigneeUserId) {
    return { ok: false, code: "ticket_held" };
  }
  if (ticket.status === "open" || ticket.status === "reopened") {
    return { ok: true, kind: "claim" };
  }
  return { ok: false, code: "illegal_transition" };
}

export function replyTransition(
  ticket: TicketSnapshot,
  actorUserId: string,
  visibility: "customer" | "internal",
):
  | { ok: true; nextStatus: "assigned" | "in_progress" }
  | { ok: false; code: "illegal_transition" } {
  if (ticket.assigneeUserId !== actorUserId) {
    return { ok: false, code: "illegal_transition" };
  }
  if (ticket.status !== "assigned" && ticket.status !== "in_progress") {
    return { ok: false, code: "illegal_transition" };
  }
  if (visibility === "customer" && ticket.status === "assigned") {
    return { ok: true, nextStatus: "in_progress" };
  }
  return { ok: true, nextStatus: ticket.status };
}

export function resolveTransition(
  ticket: TicketSnapshot,
  actorUserId: string,
): { ok: true } | { ok: false; code: "illegal_transition" } {
  if (ticket.assigneeUserId !== actorUserId) {
    return { ok: false, code: "illegal_transition" };
  }
  if (ticket.status !== "assigned" && ticket.status !== "in_progress") {
    return { ok: false, code: "illegal_transition" };
  }
  return { ok: true };
}

export function reopenTransition(
  ticket: TicketSnapshot,
): { ok: true } | { ok: false; code: "illegal_transition" } {
  if (ticket.status !== "resolved") {
    return { ok: false, code: "illegal_transition" };
  }
  return { ok: true };
}
