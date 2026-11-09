import { describe, expect, it, vi } from "vitest";

import {
  appendTurn,
  customerTicketSchema,
  humanRequestQuestion,
  postMessageResponseSchema,
  postSupportMessage,
  readTicket,
  requestFailureCopy,
  supportMessageUrl,
  ticketStatusCopy,
  ticketStatuses,
  ticketUrl,
} from "@/customer-ui/messages";
import { customerTenantsFromMemberships } from "@/server/customer-ui/viewer";

const conversationId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const userMessageId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const assistantMessageId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const ticketId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const chunkId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const documentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const tenantId = "11111111-1111-4111-8111-111111111111";

function answeredPayload() {
  return {
    conversationId,
    isPrivate: false,
    replayed: false,
    messages: [
      {
        id: userMessageId,
        role: "user",
        body: "Where is the packing slip?",
        outcome: null,
        citations: [],
        createdAt: "2026-11-09T12:00:00.000Z",
      },
      {
        id: assistantMessageId,
        role: "assistant",
        body: "The packing slip is in the box.",
        outcome: "answered",
        citations: [
          {
            chunkId,
            documentId,
            title: "Packing",
            section: "Slip",
            excerpt: "The slip sits under the lid.",
            documentVersion: 1,
            effectiveDate: null,
          },
        ],
        createdAt: "2026-11-09T12:00:01.000Z",
      },
    ],
    ticket: null,
  };
}

describe("customer chat API view", () => {
  it("keeps a logged-out question off the tenant query", () => {
    expect(supportMessageUrl(null)).toBe("/api/v1/support/messages");
    expect(supportMessageUrl(tenantId)).toBe(
      `/api/v1/support/messages?tenantId=${tenantId}`,
    );
    expect(ticketUrl(ticketId, tenantId)).toBe(
      `/api/v1/tickets/${ticketId}?tenantId=${tenantId}`,
    );
  });

  it("accepts a cited answer and rejects a failed body", () => {
    expect(postMessageResponseSchema.safeParse(answeredPayload()).success).toBe(
      true,
    );
    expect(
      postMessageResponseSchema.safeParse({ error: "support_failed" }).success,
    ).toBe(false);
    expect(
      postMessageResponseSchema.safeParse({
        ...answeredPayload(),
        ticket: { ...ticketSummary(), notes: "staff only" },
      }).success,
    ).toBe(false);
  });

  it("rejects a ticket payload that includes staff notes", () => {
    expect(customerTicketSchema.safeParse(customerTicket()).success).toBe(true);
    expect(
      customerTicketSchema.safeParse({
        ...customerTicket(),
        notes: [{ id: userMessageId, body: "internal" }],
      }).success,
    ).toBe(false);
  });

  it("does not call a failed response an answer", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ error: "support_failed" }, { status: 500 }),
      );
    const result = await postSupportMessage(
      { tenantId: null, question: "hello", conversationId: null },
      fetchImpl,
    );
    expect(result).toEqual({
      ok: false,
      message: requestFailureCopy("support_failed"),
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/v1/support/messages",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ question: "hello" }),
      }),
    );
    const init = fetchImpl.mock.calls[0]?.[1];
    const headers = new Headers(init?.headers);
    expect(headers.get("idempotency-key")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("treats an unexpected success payload as a failure", async () => {
    const result = await postSupportMessage(
      {
        tenantId: null,
        question: humanRequestQuestion,
        conversationId: null,
      },
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ answer: "sure" }, { status: 201 })),
    );
    expect(result.ok).toBe(false);
  });

  it("reads a customer ticket and stops when notes appear", async () => {
    const ok = await readTicket(
      { ticketId, tenantId },
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json(customerTicket(), { status: 200 })),
    );
    expect(ok.ok).toBe(true);
    const leaked = await readTicket(
      { ticketId, tenantId },
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json(
            { ...customerTicket(), notes: [{ body: "hidden" }] },
            { status: 200 },
          ),
        ),
    );
    expect(leaked).toEqual({
      ok: false,
      message: requestFailureCopy(null),
    });
  });

  it("says a person accepted only after the status is claimed", () => {
    for (const status of ticketStatuses) {
      const copy = ticketStatusCopy(status);
      if (status === "assigned" || status === "in_progress") {
        expect(copy.toLowerCase()).toContain("accepted");
      } else {
        expect(copy.toLowerCase()).not.toContain("accepted");
      }
    }
  });

  it("appends a turn once when the same ids are replayed", () => {
    const first = postMessageResponseSchema.parse(answeredPayload()).messages;
    expect(appendTurn([], first)).toHaveLength(2);
    expect(appendTurn(first, first)).toHaveLength(2);
  });

  it("offers only memberships that can create a conversation", () => {
    const harbor = "11111111-1111-4111-8111-111111111111";
    const northwind = "22222222-2222-4222-8222-222222222222";
    expect(
      customerTenantsFromMemberships([
        { tenantId: harbor, name: "Harbor Goods", role: "customer" },
        { tenantId: northwind, name: "Northwind", role: "support_agent" },
        { tenantId: harbor, name: "Harbor Goods", role: "customer" },
        {
          tenantId: "33333333-3333-4333-8333-333333333333",
          name: "Broken",
          role: "not_a_role",
        },
      ]),
    ).toEqual([{ id: harbor, name: "Harbor Goods" }]);
  });
});

function ticketSummary() {
  return {
    id: ticketId,
    status: "open" as const,
    reason: "customer_requested_human",
    priority: "normal",
  };
}

function customerTicket() {
  return {
    ...ticketSummary(),
    conversationId,
    requesterUserId: userMessageId,
    assigneeUserId: null,
    claimedAt: null,
    resolvedAt: null,
    createdAt: "2026-11-09T12:00:00.000Z",
    updatedAt: "2026-11-09T12:00:00.000Z",
    citations: [],
    replies: [],
  };
}
