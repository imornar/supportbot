import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import type { AccessDeps } from "@/server/auth/access";
import { DEV_USER_HEADER } from "@/server/auth/dev-identity";
import { loadMembershipAccess } from "@/server/auth/membership-access";
import { createConversationHandlers } from "@/server/conversations/handlers";
import { closePool, getDb } from "@/server/db/client";
import {
  auditEvents,
  conversations,
  messages,
  roleAssignments,
} from "@/server/db/schema";
import { seedMemberships, seedTenants, seedUsers } from "@/server/db/seed-data";
import { insertDevelopmentSeed } from "@/server/db/seed";
import type { TenantQueryClient } from "@/server/db/tenant-queries";
import { fakeEmbedder } from "@/server/documents/embed";
import {
  loadTicketModelContext,
  openEscalationTicket,
} from "@/server/tickets/store";
import { createTicketHandlers } from "@/server/tickets/handlers";
import { humanEscalationMessage } from "@/server/workflow/decision";

const databaseUrl = process.env.DATABASE_URL?.trim();
const rollback = new Error("rollback ticket test");
const harbor = seedTenants[0].id;
const northwind = seedTenants[1].id;
const ada = seedUsers[0].id;
const sam = seedUsers[2].id;
const casey = seedUsers[3].id;
const nora = seedUsers[4].id;
const jordan = seedUsers[6].id;
const note = "staff-only-note-do-not-leak";

describe.skipIf(!databaseUrl)("tickets API", () => {
  afterAll(async () => {
    await closePool();
  });

  it("creates one ticket for an open reason and hides staff notes", async () => {
    await withRollback(async (tx) => {
      await insertDevelopmentSeed(tx);
      await tx.insert(roleAssignments).values({
        tenantId: harbor,
        membershipId: seedMemberships[0].id,
        role: "support_agent",
      });
      const conversationId = randomUUID();
      await tx.insert(conversations).values({
        id: conversationId,
        tenantId: harbor,
        customerUserId: casey,
        isPrivate: true,
      });
      const handlers = createTicketHandlers({
        db: () => tx,
        accessDeps: accessFor(tx),
      });

      const created = await handlers.create(
        ticketRequest("POST", "/api/v1/tickets", casey, harbor, {
          conversationId,
          reason: "customer_requested_human",
        }),
      );
      expect(created.status).toBe(201);
      const createdBody = (await created.json()) as {
        ticket: { id: string; priority: string; status: string };
      };
      expect(createdBody.ticket.priority).toBe("normal");
      expect(createdBody.ticket.status).toBe("open");
      const ticketId = createdBody.ticket.id;

      const again = await handlers.create(
        ticketRequest("POST", "/api/v1/tickets", casey, harbor, {
          conversationId,
          reason: "customer_requested_human",
        }),
      );
      expect(again.status).toBe(200);
      expect(
        ((await again.json()) as { ticket: { id: string } }).ticket.id,
      ).toBe(ticketId);

      const rejectedPriority = await handlers.create(
        ticketRequest("POST", "/api/v1/tickets", casey, harbor, {
          conversationId,
          reason: "customer_requested_human",
          priority: "high",
        }),
      );
      expect(rejectedPriority.status).toBe(400);

      const otherCustomer = await handlers.read(
        ticketRequest("GET", `/api/v1/tickets/${ticketId}`, jordan, harbor),
        { params: Promise.resolve({ ticketId }) },
      );
      expect(otherCustomer.status).toBe(404);

      const otherTenant = await handlers.read(
        ticketRequest("GET", `/api/v1/tickets/${ticketId}`, jordan, northwind),
        { params: Promise.resolve({ ticketId }) },
      );
      expect(otherTenant.status).toBe(404);

      const northwindList = await handlers.list(
        ticketRequest("GET", "/api/v1/tickets", nora, northwind),
      );
      expect(northwindList.status).toBe(200);
      expect(JSON.stringify(await northwindList.json())).not.toContain(
        ticketId,
      );

      const unclaimedResolve = await handlers.resolve(
        ticketRequest(
          "POST",
          `/api/v1/tickets/${ticketId}/resolve`,
          sam,
          harbor,
        ),
        { params: Promise.resolve({ ticketId }) },
      );
      expect(unclaimedResolve.status).toBe(409);
      expect(await unclaimedResolve.json()).toEqual({
        error: "illegal_transition",
      });

      const customerClaim = await handlers.claim(
        ticketRequest(
          "POST",
          `/api/v1/tickets/${ticketId}/claim`,
          casey,
          harbor,
        ),
        { params: Promise.resolve({ ticketId }) },
      );
      expect(customerClaim.status).toBe(403);

      const claimed = await handlers.claim(
        ticketRequest("POST", `/api/v1/tickets/${ticketId}/claim`, sam, harbor),
        { params: Promise.resolve({ ticketId }) },
      );
      expect(claimed.status).toBe(200);
      expect(((await claimed.json()) as { status: string }).status).toBe(
        "assigned",
      );

      const stolen = await handlers.claim(
        ticketRequest("POST", `/api/v1/tickets/${ticketId}/claim`, ada, harbor),
        { params: Promise.resolve({ ticketId }) },
      );
      expect(stolen.status).toBe(409);
      expect(await stolen.json()).toEqual({ error: "ticket_held" });

      const notHolder = await handlers.resolve(
        ticketRequest(
          "POST",
          `/api/v1/tickets/${ticketId}/resolve`,
          ada,
          harbor,
        ),
        { params: Promise.resolve({ ticketId }) },
      );
      expect(notHolder.status).toBe(409);
      expect(await notHolder.json()).toEqual({ error: "illegal_transition" });

      const noted = await handlers.reply(
        ticketRequest(
          "POST",
          `/api/v1/tickets/${ticketId}/replies`,
          sam,
          harbor,
          {
            body: note,
            visibility: "internal",
          },
        ),
        { params: Promise.resolve({ ticketId }) },
      );
      expect(noted.status).toBe(200);
      const staffBody = await noted.json();
      expect(JSON.stringify(staffBody)).toContain(note);

      const replied = await handlers.reply(
        ticketRequest(
          "POST",
          `/api/v1/tickets/${ticketId}/replies`,
          sam,
          harbor,
          {
            body: "A person is looking at this now.",
            visibility: "customer",
          },
        ),
        { params: Promise.resolve({ ticketId }) },
      );
      expect(replied.status).toBe(200);
      expect(((await replied.json()) as { status: string }).status).toBe(
        "in_progress",
      );

      const customerView = await handlers.read(
        ticketRequest("GET", `/api/v1/tickets/${ticketId}`, casey, harbor),
        { params: Promise.resolve({ ticketId }) },
      );
      expect(customerView.status).toBe(200);
      const customerJson = await customerView.json();
      const serialized = JSON.stringify(customerJson);
      expect(serialized).not.toContain(note);
      expect(serialized).not.toContain("internal");
      expect(customerJson).not.toHaveProperty("notes");
      expect(customerJson).not.toHaveProperty("note");
      expect(customerJson).not.toHaveProperty("visibility");

      const context = await loadTicketModelContext(tx, harbor, ticketId);
      expect(context).not.toContain(note);
      expect(context).toContain("A person is looking at this now.");

      const resolved = await handlers.resolve(
        ticketRequest(
          "POST",
          `/api/v1/tickets/${ticketId}/resolve`,
          sam,
          harbor,
        ),
        { params: Promise.resolve({ ticketId }) },
      );
      expect(resolved.status).toBe(200);
      expect(((await resolved.json()) as { status: string }).status).toBe(
        "resolved",
      );

      const reopened = await handlers.reopen(
        ticketRequest(
          "POST",
          `/api/v1/tickets/${ticketId}/reopen`,
          ada,
          harbor,
        ),
        { params: Promise.resolve({ ticketId }) },
      );
      expect(reopened.status).toBe(200);
      const reopenedBody = (await reopened.json()) as {
        status: string;
        assigneeUserId: string | null;
      };
      expect(reopenedBody.status).toBe("reopened");
      expect(reopenedBody.assigneeUserId).toBeNull();

      const second = await handlers.create(
        ticketRequest("POST", "/api/v1/tickets", casey, harbor, {
          conversationId,
          reason: "customer_requested_human",
        }),
      );
      expect(second.status).toBe(200);
      expect(
        ((await second.json()) as { ticket: { id: string } }).ticket.id,
      ).toBe(ticketId);

      const actions = await tx
        .select({ action: auditEvents.action })
        .from(auditEvents)
        .where(eq(auditEvents.targetId, ticketId));
      expect(actions.map((row) => row.action).sort()).toEqual(
        [
          "ticket.claim",
          "ticket.create",
          "ticket.note",
          "ticket.reopen",
          "ticket.reply",
          "ticket.resolve",
        ].sort(),
      );
    });
  });

  it("opens a ticket when a human request survives a failing model", async () => {
    await withRollback(async (tx) => {
      await insertDevelopmentSeed(tx);
      const env = {
        NODE_ENV: "test",
        SUPPORTPILOT_ALLOW_DEV_IDENTITY: "true",
        SUPPORTPILOT_PUBLIC_TENANT_SLUG: "harbor",
        SUPPORTPILOT_RATE_LIMIT_PER_MINUTE: "10",
      };
      let modelCalls = 0;
      const conversationsApi = createConversationHandlers({
        db: () => tx,
        embedder: () => fakeEmbedder(),
        chat: () => ({
          model: "fixture-model",
          complete: async () => {
            modelCalls += 1;
            throw new Error("model down");
          },
        }),
        retrievalSettings: () => ({ topK: 5, similarityThreshold: 0.3 }),
        now: () => new Date("2026-11-09T12:00:00.000Z"),
        env,
        accessDeps: accessFor(tx),
      });
      const created = await conversationsApi.post(
        messageRequest(casey, harbor, "Please talk to a human"),
      );
      expect(created.status).toBe(201);
      const body = (await created.json()) as {
        ticket: { id: string; status: string } | null;
        messages: Array<{ body: string }>;
      };
      expect(modelCalls).toBe(0);
      expect(body.messages[1]?.body).toBe(humanEscalationMessage);
      expect(body.messages[1]?.body).not.toMatch(/\bhas accepted\b/);
      expect(body.ticket?.status).toBe("open");

      const handlers = createTicketHandlers({
        db: () => tx,
        accessDeps: accessFor(tx),
      });
      const ticketId = body.ticket?.id ?? "";
      await handlers.claim(
        ticketRequest("POST", `/api/v1/tickets/${ticketId}/claim`, sam, harbor),
        { params: Promise.resolve({ ticketId }) },
      );
      const [stored] = await tx
        .select({ body: messages.body })
        .from(messages)
        .where(eq(messages.role, "assistant"));
      expect(stored?.body).toBe(humanEscalationMessage);
      expect(stored?.body).not.toMatch(/\bhas accepted\b/);

      const anonymous = await conversationsApi.post(
        messageRequest(null, null, "I want to talk to a human"),
      );
      expect(anonymous.status).toBe(201);
      const anonymousBody = (await anonymous.json()) as { ticket: unknown };
      expect(anonymousBody.ticket).toBeNull();
    });
  });

  it("stores workflow failure at high priority without a second open ticket", async () => {
    await withRollback(async (tx) => {
      await insertDevelopmentSeed(tx);
      const conversationId = randomUUID();
      await tx.insert(conversations).values({
        id: conversationId,
        tenantId: harbor,
        customerUserId: casey,
        isPrivate: true,
      });
      const first = await openEscalationTicket(tx, {
        tenantId: harbor,
        conversationId,
        requesterUserId: casey,
        reason: "workflow_failure",
        sourceMessageId: null,
        citations: [],
        actorUserId: casey,
      });
      const second = await openEscalationTicket(tx, {
        tenantId: harbor,
        conversationId,
        requesterUserId: casey,
        reason: "workflow_failure",
        sourceMessageId: null,
        citations: [],
        actorUserId: casey,
      });
      expect(first.priority).toBe("high");
      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(second.id).toBe(first.id);

      const low = await openEscalationTicket(tx, {
        tenantId: harbor,
        conversationId,
        requesterUserId: casey,
        reason: "insufficient_evidence",
        sourceMessageId: null,
        citations: [],
        actorUserId: casey,
      });
      expect(low.priority).toBe("low");
      expect(low.id).not.toBe(first.id);
    });
  });
});

function accessFor(tx: TenantQueryClient): AccessDeps {
  return {
    env: {
      NODE_ENV: "test",
      SUPPORTPILOT_ALLOW_DEV_IDENTITY: "true",
    },
    readSession: async () => null,
    findUserBySubject: async () => null,
    findMembership: (userId, tenantId) =>
      loadMembershipAccess(tx, userId, tenantId),
  };
}

function ticketRequest(
  method: string,
  path: string,
  userId: string,
  tenantId: string,
  body?: Record<string, unknown>,
): Request {
  const url = new URL(`http://localhost:3000${path}`);
  url.searchParams.set("tenantId", tenantId);
  return new Request(url, {
    method,
    headers: {
      "content-type": "application/json",
      [DEV_USER_HEADER]: userId,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function messageRequest(
  userId: string | null,
  tenantId: string | null,
  question: string,
): Request {
  const url = new URL("http://localhost:3000/api/v1/support/messages");
  if (tenantId) {
    url.searchParams.set("tenantId", tenantId);
  }
  const headers = new Headers({
    "content-type": "application/json",
    "idempotency-key": randomUUID(),
  });
  if (userId) {
    headers.set(DEV_USER_HEADER, userId);
  }
  return new Request(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ question }),
  });
}

async function withRollback(
  run: (tx: TenantQueryClient) => Promise<void>,
): Promise<void> {
  try {
    await getDb().transaction(async (tx) => {
      await run(tx);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) {
      throw error;
    }
  }
}
