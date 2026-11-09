import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";

import { storedCitationSchema } from "@/server/conversations/schema";
import { insertAuditEvent } from "@/server/db/audit";
import {
  conversations,
  messages,
  ticketMessages,
  tickets,
} from "@/server/db/schema";
import type { TenantQueryClient } from "@/server/db/tenant-queries";
import { buildTicketModelContext } from "@/server/tickets/context";
import {
  claimTransition,
  priorityForReason,
  reopenTransition,
  replyTransition,
  resolveTransition,
  type TicketReason,
  type TicketSnapshot,
  type TicketStatus,
} from "@/server/tickets/machine";
import {
  customerTicketListSchema,
  customerTicketSchema,
  staffTicketSchema,
  ticketSummarySchema,
  type CustomerTicket,
  type StaffTicket,
  type TicketAudience,
  type TicketSummary,
} from "@/server/tickets/schema";

const listLimit = 50;
const messageLimit = 200;

const activeStatuses = [
  "open",
  "assigned",
  "in_progress",
  "reopened",
] as const satisfies readonly TicketStatus[];

export class TicketRequestError extends Error {
  readonly code: "not_found" | "illegal_transition" | "ticket_held";

  constructor(code: TicketRequestError["code"]) {
    super("Ticket request failed. Values are omitted.");
    this.name = "TicketRequestError";
    this.code = code;
  }
}

type TicketActor = {
  tenantId: string;
  userId: string;
  audience: TicketAudience;
};

export async function openEscalationTicket(
  db: TenantQueryClient,
  input: {
    tenantId: string;
    conversationId: string;
    requesterUserId: string;
    reason: TicketReason;
    sourceMessageId: string | null;
    citations: unknown;
    actorUserId: string;
  },
): Promise<TicketSummary & { created: boolean }> {
  const citations = acceptCitations(input.citations);
  const inserted = await db
    .insert(tickets)
    .values({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      requesterUserId: input.requesterUserId,
      reason: input.reason,
      priority: priorityForReason(input.reason),
      status: "open",
      sourceMessageId: input.sourceMessageId,
      citations,
    })
    .onConflictDoNothing()
    .returning({
      id: tickets.id,
      status: tickets.status,
      reason: tickets.reason,
      priority: tickets.priority,
    });
  const created = inserted[0];
  if (created) {
    await insertAuditEvent(db, {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "ticket.create",
      targetType: "ticket",
      targetId: created.id,
    });
    return {
      ...ticketSummarySchema.parse(created),
      created: true,
    };
  }

  const [existing] = await db
    .select({
      id: tickets.id,
      status: tickets.status,
      reason: tickets.reason,
      priority: tickets.priority,
    })
    .from(tickets)
    .where(
      and(
        eq(tickets.tenantId, input.tenantId),
        eq(tickets.conversationId, input.conversationId),
        eq(tickets.reason, input.reason),
        inArray(tickets.status, [...activeStatuses]),
      ),
    )
    .limit(1);
  if (!existing) {
    throw new TicketRequestError("not_found");
  }
  return {
    ...ticketSummarySchema.parse(existing),
    created: false,
  };
}

export async function createCustomerTicket(
  db: TenantQueryClient,
  input: {
    tenantId: string;
    userId: string;
    conversationId: string;
    reason: "customer_requested_human";
  },
): Promise<{ ticket: CustomerTicket; created: boolean }> {
  return db.transaction(async (tx) => {
    const owned = await ownsConversation(
      tx,
      input.tenantId,
      input.userId,
      input.conversationId,
    );
    if (!owned) {
      throw new TicketRequestError("not_found");
    }
    const opened = await openEscalationTicket(tx, {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      requesterUserId: input.userId,
      reason: input.reason,
      sourceMessageId: null,
      citations: [],
      actorUserId: input.userId,
    });
    const ticket = await presentTicket(tx, {
      tenantId: input.tenantId,
      ticketId: opened.id,
      actorUserId: input.userId,
      audience: "customer",
    });
    if (!ticket || ticket.audience !== "customer") {
      throw new TicketRequestError("not_found");
    }
    return { ticket: ticket.ticket, created: opened.created };
  });
}

export async function listTickets(db: TenantQueryClient, actor: TicketActor) {
  const rows = await db
    .select({
      id: tickets.id,
      conversationId: tickets.conversationId,
      requesterUserId: tickets.requesterUserId,
      reason: tickets.reason,
      priority: tickets.priority,
      status: tickets.status,
      assigneeUserId: tickets.assigneeUserId,
      claimedAt: tickets.claimedAt,
      resolvedAt: tickets.resolvedAt,
      createdAt: tickets.createdAt,
      updatedAt: tickets.updatedAt,
    })
    .from(tickets)
    .where(
      and(
        eq(tickets.tenantId, actor.tenantId),
        actor.audience === "customer"
          ? eq(tickets.requesterUserId, actor.userId)
          : undefined,
      ),
    )
    .orderBy(desc(tickets.updatedAt))
    .limit(listLimit);
  return customerTicketListSchema.parse({
    tickets: rows.map((row) => ({
      id: row.id,
      conversationId: row.conversationId,
      requesterUserId: row.requesterUserId,
      reason: row.reason,
      priority: row.priority,
      status: row.status,
      assigneeUserId: row.assigneeUserId,
      claimedAt: iso(row.claimedAt),
      resolvedAt: iso(row.resolvedAt),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
  });
}

export async function readTicket(
  db: TenantQueryClient,
  actor: TicketActor,
  ticketId: string,
) {
  const presented = await presentTicket(db, {
    tenantId: actor.tenantId,
    ticketId,
    actorUserId: actor.userId,
    audience: actor.audience,
  });
  if (!presented) {
    throw new TicketRequestError("not_found");
  }
  return presented.ticket;
}

export async function claimTicket(
  db: TenantQueryClient,
  actor: TicketActor,
  ticketId: string,
) {
  return db.transaction(async (tx) => {
    const current = await snapshot(tx, actor.tenantId, ticketId);
    if (!current) {
      throw new TicketRequestError("not_found");
    }
    const decision = claimTransition(current, actor.userId);
    if (!decision.ok) {
      throw new TicketRequestError(decision.code);
    }
    if (decision.kind === "claim") {
      const now = new Date();
      const updated = await tx
        .update(tickets)
        .set({
          status: "assigned",
          assigneeUserId: actor.userId,
          claimedAt: now,
          resolvedAt: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(tickets.id, ticketId),
            eq(tickets.tenantId, actor.tenantId),
            inArray(tickets.status, ["open", "reopened"]),
          ),
        )
        .returning({ id: tickets.id });
      if (updated.length === 0) {
        throw new TicketRequestError("ticket_held");
      }
      await insertAuditEvent(tx, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "ticket.claim",
        targetType: "ticket",
        targetId: ticketId,
      });
    }
    return readTicket(tx, { ...actor, audience: "agent" }, ticketId);
  });
}

export async function replyToTicket(
  db: TenantQueryClient,
  actor: TicketActor,
  ticketId: string,
  input: { body: string; visibility: "customer" | "internal" },
) {
  return db.transaction(async (tx) => {
    const current = await snapshot(tx, actor.tenantId, ticketId);
    if (!current) {
      throw new TicketRequestError("not_found");
    }
    const decision = replyTransition(current, actor.userId, input.visibility);
    if (!decision.ok) {
      throw new TicketRequestError(decision.code);
    }
    const now = new Date();
    await tx.insert(ticketMessages).values({
      tenantId: actor.tenantId,
      ticketId,
      authorUserId: actor.userId,
      visibility: input.visibility,
      body: input.body,
    });
    const updated = await tx
      .update(tickets)
      .set({
        status: decision.nextStatus,
        updatedAt: now,
      })
      .where(
        and(
          eq(tickets.id, ticketId),
          eq(tickets.tenantId, actor.tenantId),
          eq(tickets.assigneeUserId, actor.userId),
          inArray(tickets.status, ["assigned", "in_progress"]),
        ),
      )
      .returning({ id: tickets.id });
    if (updated.length === 0) {
      throw new TicketRequestError("illegal_transition");
    }
    await insertAuditEvent(tx, {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: input.visibility === "internal" ? "ticket.note" : "ticket.reply",
      targetType: "ticket",
      targetId: ticketId,
    });
    return readTicket(tx, { ...actor, audience: "agent" }, ticketId);
  });
}

export async function resolveTicket(
  db: TenantQueryClient,
  actor: TicketActor,
  ticketId: string,
) {
  return db.transaction(async (tx) => {
    const current = await snapshot(tx, actor.tenantId, ticketId);
    if (!current) {
      throw new TicketRequestError("not_found");
    }
    const decision = resolveTransition(current, actor.userId);
    if (!decision.ok) {
      throw new TicketRequestError(decision.code);
    }
    const now = new Date();
    const updated = await tx
      .update(tickets)
      .set({
        status: "resolved",
        resolvedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(tickets.id, ticketId),
          eq(tickets.tenantId, actor.tenantId),
          eq(tickets.assigneeUserId, actor.userId),
          inArray(tickets.status, ["assigned", "in_progress"]),
        ),
      )
      .returning({ id: tickets.id });
    if (updated.length === 0) {
      throw new TicketRequestError("illegal_transition");
    }
    await insertAuditEvent(tx, {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "ticket.resolve",
      targetType: "ticket",
      targetId: ticketId,
    });
    return readTicket(tx, { ...actor, audience: "agent" }, ticketId);
  });
}

export async function reopenTicket(
  db: TenantQueryClient,
  actor: TicketActor,
  ticketId: string,
) {
  return db.transaction(async (tx) => {
    const current = await snapshot(tx, actor.tenantId, ticketId);
    if (!current) {
      throw new TicketRequestError("not_found");
    }
    const decision = reopenTransition(current);
    if (!decision.ok) {
      throw new TicketRequestError(decision.code);
    }
    const now = new Date();
    const updated = await tx
      .update(tickets)
      .set({
        status: "reopened",
        assigneeUserId: null,
        claimedAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(tickets.id, ticketId),
          eq(tickets.tenantId, actor.tenantId),
          eq(tickets.status, "resolved"),
        ),
      )
      .returning({ id: tickets.id });
    if (updated.length === 0) {
      throw new TicketRequestError("illegal_transition");
    }
    await insertAuditEvent(tx, {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "ticket.reopen",
      targetType: "ticket",
      targetId: ticketId,
    });
    return readTicket(tx, { ...actor, audience: "agent" }, ticketId);
  });
}

export async function ticketSummaryById(
  db: TenantQueryClient,
  tenantId: string,
  ticketId: string,
): Promise<TicketSummary | null> {
  const [row] = await db
    .select({
      id: tickets.id,
      status: tickets.status,
      reason: tickets.reason,
      priority: tickets.priority,
    })
    .from(tickets)
    .where(and(eq(tickets.id, ticketId), eq(tickets.tenantId, tenantId)))
    .limit(1);
  if (!row) {
    return null;
  }
  return ticketSummarySchema.parse(row);
}

export async function loadTicketModelContext(
  db: TenantQueryClient,
  tenantId: string,
  ticketId: string,
): Promise<string | null> {
  const [ticket] = await db
    .select({
      id: tickets.id,
      reason: tickets.reason,
      status: tickets.status,
      conversationId: tickets.conversationId,
    })
    .from(tickets)
    .where(and(eq(tickets.id, ticketId), eq(tickets.tenantId, tenantId)))
    .limit(1);
  if (!ticket) {
    return null;
  }
  const conversation = await db
    .select({
      role: messages.role,
      body: messages.body,
    })
    .from(messages)
    .where(
      and(
        eq(messages.tenantId, tenantId),
        eq(messages.conversationId, ticket.conversationId),
      ),
    )
    .orderBy(messages.createdAt)
    .limit(messageLimit);
  const customerReplies = await db
    .select({ body: ticketMessages.body })
    .from(ticketMessages)
    .where(
      and(
        eq(ticketMessages.tenantId, tenantId),
        eq(ticketMessages.ticketId, ticket.id),
        eq(ticketMessages.visibility, "customer"),
      ),
    )
    .orderBy(ticketMessages.createdAt)
    .limit(messageLimit);
  return buildTicketModelContext({
    reason: ticket.reason,
    status: ticket.status,
    conversation,
    customerReplies,
  });
}

async function presentTicket(
  db: TenantQueryClient,
  input: {
    tenantId: string;
    ticketId: string;
    actorUserId: string;
    audience: TicketAudience;
  },
): Promise<
  | { audience: "customer"; ticket: CustomerTicket }
  | { audience: "agent" | "queue"; ticket: StaffTicket }
  | null
> {
  const [row] = await db
    .select({
      id: tickets.id,
      conversationId: tickets.conversationId,
      requesterUserId: tickets.requesterUserId,
      reason: tickets.reason,
      priority: tickets.priority,
      status: tickets.status,
      assigneeUserId: tickets.assigneeUserId,
      claimedAt: tickets.claimedAt,
      resolvedAt: tickets.resolvedAt,
      createdAt: tickets.createdAt,
      updatedAt: tickets.updatedAt,
      citations: tickets.citations,
    })
    .from(tickets)
    .where(
      and(eq(tickets.id, input.ticketId), eq(tickets.tenantId, input.tenantId)),
    )
    .limit(1);
  if (!row) {
    return null;
  }
  if (
    input.audience === "customer" &&
    row.requesterUserId !== input.actorUserId
  ) {
    return null;
  }
  const replyRows = await db
    .select({
      id: ticketMessages.id,
      body: ticketMessages.body,
      createdAt: ticketMessages.createdAt,
      authorUserId: ticketMessages.authorUserId,
      visibility: ticketMessages.visibility,
    })
    .from(ticketMessages)
    .where(
      and(
        eq(ticketMessages.tenantId, input.tenantId),
        eq(ticketMessages.ticketId, row.id),
        input.audience === "agent"
          ? undefined
          : eq(ticketMessages.visibility, "customer"),
      ),
    )
    .orderBy(ticketMessages.createdAt)
    .limit(messageLimit);
  const core = {
    id: row.id,
    conversationId: row.conversationId,
    requesterUserId: row.requesterUserId,
    reason: row.reason,
    priority: row.priority,
    status: row.status,
    assigneeUserId: row.assigneeUserId,
    claimedAt: iso(row.claimedAt),
    resolvedAt: iso(row.resolvedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    citations: acceptCitations(row.citations),
    replies: replyRows
      .filter((message) => message.visibility === "customer")
      .map(messageJson),
  };
  if (input.audience === "customer") {
    return {
      audience: "customer",
      ticket: customerTicketSchema.parse(core),
    };
  }
  const conversation = await db
    .select({
      id: messages.id,
      role: messages.role,
      body: messages.body,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(
      and(
        eq(messages.tenantId, input.tenantId),
        eq(messages.conversationId, row.conversationId),
      ),
    )
    .orderBy(messages.createdAt)
    .limit(messageLimit);
  return {
    audience: input.audience,
    ticket: staffTicketSchema.parse({
      ...core,
      notes:
        input.audience === "agent"
          ? replyRows
              .filter((message) => message.visibility === "internal")
              .map(messageJson)
          : [],
      conversation: conversation.map((message) => ({
        id: message.id,
        role: message.role,
        body: message.body,
        createdAt: message.createdAt.toISOString(),
      })),
    }),
  };
}

async function snapshot(
  db: TenantQueryClient,
  tenantId: string,
  ticketId: string,
): Promise<TicketSnapshot | null> {
  const [row] = await db
    .select({
      status: tickets.status,
      assigneeUserId: tickets.assigneeUserId,
    })
    .from(tickets)
    .where(and(eq(tickets.id, ticketId), eq(tickets.tenantId, tenantId)))
    .limit(1);
  return row ?? null;
}

async function ownsConversation(
  db: TenantQueryClient,
  tenantId: string,
  userId: string,
  conversationId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.tenantId, tenantId),
        eq(conversations.customerUserId, userId),
        eq(conversations.isPrivate, true),
      ),
    )
    .limit(1);
  return Boolean(row);
}

function acceptCitations(value: unknown) {
  const parsed = storedCitationSchema.array().max(20).safeParse(value);
  return parsed.success ? parsed.data : [];
}

function messageJson(message: {
  id: string;
  body: string;
  createdAt: Date;
  authorUserId: string;
}) {
  return {
    id: message.id,
    body: message.body,
    createdAt: message.createdAt.toISOString(),
    authorUserId: message.authorUserId,
  };
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}
