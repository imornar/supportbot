import { describe, expect, it } from "vitest";

import { buildTicketModelContext } from "@/server/tickets/context";
import {
  claimTransition,
  priorityForReason,
  reopenTransition,
  replyTransition,
  resolveTransition,
  ticketReasons,
} from "@/server/tickets/machine";
import {
  createTicketBodySchema,
  customerTicketSchema,
} from "@/server/tickets/schema";
import { humanEscalationMessage } from "@/server/workflow/decision";

const agent = "10000000-0000-4000-8000-000000000003";
const other = "10000000-0000-4000-8000-000000000001";

describe("ticket priority", () => {
  it("assigns priority from the reason and ignores a client priority field", () => {
    expect(priorityForReason("sensitive_request")).toBe("high");
    expect(priorityForReason("conflicting_sources")).toBe("high");
    expect(priorityForReason("workflow_failure")).toBe("high");
    expect(priorityForReason("customer_requested_human")).toBe("normal");
    expect(priorityForReason("business_tool_unavailable")).toBe("normal");
    expect(priorityForReason("repeated_attempts")).toBe("normal");
    expect(priorityForReason("insufficient_evidence")).toBe("low");
    expect(ticketReasons).toHaveLength(7);
    expect(
      createTicketBodySchema.safeParse({
        conversationId: "11111111-1111-4111-8111-111111111111",
        reason: "customer_requested_human",
        priority: "high",
      }).success,
    ).toBe(false);
  });
});

describe("ticket transitions", () => {
  it("rejects resolve when the agent does not hold the ticket", () => {
    expect(
      resolveTransition({ status: "assigned", assigneeUserId: agent }, other),
    ).toEqual({ ok: false, code: "illegal_transition" });
    expect(
      resolveTransition({ status: "open", assigneeUserId: null }, agent),
    ).toEqual({ ok: false, code: "illegal_transition" });
    expect(
      claimTransition({ status: "assigned", assigneeUserId: agent }, other),
    ).toEqual({ ok: false, code: "ticket_held" });
    expect(
      claimTransition({ status: "closed", assigneeUserId: null }, agent),
    ).toEqual({ ok: false, code: "illegal_transition" });
    expect(
      replyTransition(
        { status: "open", assigneeUserId: null },
        agent,
        "internal",
      ),
    ).toEqual({ ok: false, code: "illegal_transition" });
    expect(reopenTransition({ status: "open", assigneeUserId: null })).toEqual({
      ok: false,
      code: "illegal_transition",
    });
  });

  it("claims, replies, resolves, and reopens in order", () => {
    expect(
      claimTransition({ status: "open", assigneeUserId: null }, agent),
    ).toEqual({ ok: true, kind: "claim" });
    expect(
      claimTransition({ status: "assigned", assigneeUserId: agent }, agent),
    ).toEqual({ ok: true, kind: "unchanged" });
    expect(
      replyTransition(
        { status: "assigned", assigneeUserId: agent },
        agent,
        "internal",
      ),
    ).toEqual({ ok: true, nextStatus: "assigned" });
    expect(
      replyTransition(
        { status: "assigned", assigneeUserId: agent },
        agent,
        "customer",
      ),
    ).toEqual({ ok: true, nextStatus: "in_progress" });
    expect(
      resolveTransition(
        { status: "in_progress", assigneeUserId: agent },
        agent,
      ),
    ).toEqual({ ok: true });
    expect(
      reopenTransition({ status: "resolved", assigneeUserId: agent }),
    ).toEqual({ ok: true });
    expect(
      claimTransition({ status: "reopened", assigneeUserId: null }, other),
    ).toEqual({ ok: true, kind: "claim" });
  });
});

describe("ticket model context", () => {
  it("includes customer replies and has no place for a staff note", () => {
    const context = buildTicketModelContext({
      reason: "customer_requested_human",
      status: "in_progress",
      conversation: [{ role: "user", body: "I need a person" }],
      customerReplies: [{ body: "I can help with the order." }],
    });
    expect(context).toContain("I need a person");
    expect(context).toContain("I can help with the order.");
    expect(context).not.toContain("staff-only-note-do-not-leak");
    expect(humanEscalationMessage).not.toMatch(/\bhas accepted\b/);
    expect("notes" in customerTicketSchema.shape).toBe(false);
  });
});
