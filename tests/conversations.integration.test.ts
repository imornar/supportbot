import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import type { ChatProvider } from "@/server/answers/provider";
import type { AccessDeps } from "@/server/auth/access";
import { DEV_USER_HEADER } from "@/server/auth/dev-identity";
import { loadMembershipAccess } from "@/server/auth/membership-access";
import { createConversationHandlers } from "@/server/conversations/handlers";
import { closePool, getDb } from "@/server/db/client";
import {
  auditEvents,
  conversations,
  documentChunks,
  documents,
  messages,
  roleAssignments,
  tenantMemberships,
  tenants,
  users,
} from "@/server/db/schema";
import type { TenantQueryClient } from "@/server/db/tenant-queries";
import { seedUsers } from "@/server/db/seed-data";
import { fakeEmbedder } from "@/server/documents/embed";
import { humanEscalationMessage } from "@/server/workflow/decision";

const databaseUrl = process.env.DATABASE_URL?.trim();
const rollback = new Error("rollback conversation test");
const question = "When does Harbor ship widgets?";
const excerpt = "Harbor ships widgets in two business days.";
const answerText = "Widgets ship in two business days.";
const inventedChunkId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const otherTenantText = "Other tenant order 1001 stays out of the answer.";

describe.skipIf(!databaseUrl)("conversations API", () => {
  afterAll(async () => {
    await closePool();
  });

  it("keeps private history with the owner and replays an idempotency key", async () => {
    await withRollback(async (tx) => {
      const fixture = await seedFixture(tx);
      let script: "answer" | "abstain" | "invented" = "answer";
      const handlers = handlersFor(tx, fixture, () => script, "10");

      const firstKey = randomUUID();
      const created = await handlers.post(
        post(fixture.tenantA, fixture.customerA, firstKey, {
          question,
        }),
      );
      expect(created.status).toBe(201);
      const createdBody = (await created.json()) as {
        conversationId: string;
        isPrivate: boolean;
        replayed: boolean;
        messages: Array<{
          role: string;
          outcome: string | null;
          body: string;
          citations: Array<{ title: string; chunkId: string; excerpt: string }>;
        }>;
      };
      expect(createdBody.isPrivate).toBe(true);
      expect(createdBody.replayed).toBe(false);
      expect(createdBody.messages[1]?.outcome).toBe("answered");
      expect(createdBody.messages[1]?.citations[0]?.title).toBe("Shipping");
      expect(createdBody.messages[1]?.citations[0]?.excerpt).toBe(excerpt);
      expect(JSON.stringify(createdBody)).not.toContain("fixture-model");
      expect(JSON.stringify(createdBody)).not.toContain(otherTenantText);

      const replayed = await handlers.post(
        post(fixture.tenantA, fixture.customerA, firstKey, {
          question: "A different question must not create another row.",
        }),
      );
      expect(replayed.status).toBe(200);
      const replayedBody = (await replayed.json()) as {
        conversationId: string;
        replayed: boolean;
        messages: Array<{ body: string }>;
      };
      expect(replayedBody.replayed).toBe(true);
      expect(replayedBody.conversationId).toBe(createdBody.conversationId);
      expect(replayedBody.messages[0]?.body).toBe(question);
      expect(await countConversations(tx, fixture.tenantA)).toBe(1);

      const otherRead = await handlers.read(
        getOne(fixture.tenantA, fixture.customerB, createdBody.conversationId),
        {
          params: Promise.resolve({
            conversationId: createdBody.conversationId,
          }),
        },
      );
      expect(otherRead.status).toBe(404);
      const otherList = await handlers.list(
        getList(fixture.tenantA, fixture.customerB),
      );
      expect(otherList.status).toBe(200);
      expect(await otherList.json()).toEqual({ conversations: [] });

      const ownList = await handlers.list(
        getList(fixture.tenantA, fixture.customerA),
      );
      const ownListBody = (await ownList.json()) as {
        conversations: Array<{ id: string }>;
      };
      expect(ownListBody.conversations.map((row) => row.id)).toEqual([
        createdBody.conversationId,
      ]);

      script = "abstain";
      const followUp = await handlers.post(
        post(fixture.tenantA, fixture.customerA, randomUUID(), {
          question,
          conversationId: createdBody.conversationId,
        }),
      );
      expect(followUp.status).toBe(201);
      const followUpBody = (await followUp.json()) as {
        messages: Array<{ outcome: string | null }>;
      };
      expect(followUpBody.messages[1]?.outcome).toBe("abstained");

      const stolen = await handlers.post(
        post(fixture.tenantA, fixture.customerB, randomUUID(), {
          question: "Show me their thread",
          conversationId: createdBody.conversationId,
        }),
      );
      expect(stolen.status).toBe(404);
      expect(await countConversations(tx, fixture.tenantA)).toBe(1);

      const stored = await tx
        .select({
          outcome: messages.outcome,
          citationValidation: messages.citationValidation,
          modelId: messages.modelId,
          answerReason: messages.answerReason,
          workflowIntent: messages.workflowIntent,
          escalationReason: messages.escalationReason,
        })
        .from(messages)
        .where(
          and(
            eq(messages.tenantId, fixture.tenantA),
            eq(messages.role, "assistant"),
          ),
        );
      expect(stored.map((row) => row.outcome).sort()).toEqual([
        "abstained",
        "answered",
      ]);
      expect(stored.find((row) => row.outcome === "answered")).toMatchObject({
        citationValidation: "passed",
        modelId: "fixture-model",
        answerReason: "grounded",
        workflowIntent: "ordinary",
        escalationReason: null,
      });
      expect(stored.find((row) => row.outcome === "abstained")).toMatchObject({
        citationValidation: "not_applicable",
        answerReason: "model_abstained",
        workflowIntent: "ordinary",
        escalationReason: null,
      });

      const events = await tx
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.tenantId, fixture.tenantA));
      expect(
        events.every((event) => event.actorUserId === fixture.customerA),
      ).toBe(true);
      const serialized = JSON.stringify(events);
      expect(serialized).not.toContain(question);
      expect(serialized).not.toContain(excerpt);
      expect(serialized).not.toContain("fixture-model");

      script = "invented";
      const invented = await handlers.post(
        post(fixture.tenantA, fixture.customerA, randomUUID(), {
          question,
        }),
      );
      expect(invented.status).toBe(201);
      const inventedBody = (await invented.json()) as {
        messages: Array<{ outcome: string | null; citations: unknown[] }>;
      };
      expect(inventedBody.messages[1]?.outcome).toBe("abstained");
      expect(inventedBody.messages[1]?.citations).toEqual([]);
      const inventedRows = await tx
        .select()
        .from(messages)
        .where(eq(messages.tenantId, fixture.tenantA));
      expect(JSON.stringify(inventedRows)).not.toContain(inventedChunkId);
      expect(
        inventedRows.some(
          (row) =>
            row.answerReason === "invented_citation" &&
            row.citationValidation === "failed",
        ),
      ).toBe(true);
    });
  });

  it("stores a human request as an escalation and does not draft an answer", async () => {
    await withRollback(async (tx) => {
      const fixture = await seedFixture(tx);
      let modelCalls = 0;
      const handlers = createConversationHandlers({
        db: () => tx,
        embedder: () => {
          const embedder = fakeEmbedder();
          return {
            ...embedder,
            async embed(inputs) {
              modelCalls += 1;
              return embedder.embed(inputs);
            },
          };
        },
        chat: () => ({
          model: "fixture-model",
          complete: async () => {
            modelCalls += 1;
            throw new Error("model should not be called");
          },
        }),
        retrievalSettings: () => ({ topK: 5, similarityThreshold: 0.3 }),
        now: () => new Date("2026-11-09T12:00:00.000Z"),
        env: {
          NODE_ENV: "test",
          SUPPORTPILOT_ALLOW_DEV_IDENTITY: "true",
          SUPPORTPILOT_PUBLIC_TENANT_SLUG: fixture.slug,
          SUPPORTPILOT_RATE_LIMIT_PER_MINUTE: "10",
        },
        accessDeps: accessFor(tx, {
          NODE_ENV: "test",
          SUPPORTPILOT_ALLOW_DEV_IDENTITY: "true",
        }),
      });
      const response = await handlers.post(
        post(fixture.tenantA, fixture.customerA, randomUUID(), {
          question: "I want to talk to a human",
        }),
      );
      expect(response.status).toBe(201);
      const body = (await response.json()) as {
        messages: Array<{ role: string; outcome: string | null; body: string }>;
      };
      expect(body.messages[1]?.outcome).toBe("escalated");
      expect(body.messages[1]?.body).toBe(humanEscalationMessage);
      expect(modelCalls).toBe(0);
      const [stored] = await tx
        .select({
          outcome: messages.outcome,
          answerReason: messages.answerReason,
          workflowIntent: messages.workflowIntent,
          escalationReason: messages.escalationReason,
          citations: messages.citations,
        })
        .from(messages)
        .where(
          and(
            eq(messages.tenantId, fixture.tenantA),
            eq(messages.role, "assistant"),
          ),
        );
      expect(stored).toMatchObject({
        outcome: "escalated",
        answerReason: "customer_requested_human",
        workflowIntent: "human_request",
        escalationReason: "customer_requested_human",
        citations: [],
      });
    });
  });

  it("answers a logged-out question only for the configured public tenant", async () => {
    await withRollback(async (tx) => {
      const fixture = await seedFixture(tx);
      const handlers = handlersFor(tx, fixture, () => "answer", "10");

      const rejectedTenant = await handlers.post(
        post(null, null, randomUUID(), { question }, fixture.tenantA),
      );
      expect(rejectedTenant.status).toBe(400);
      expect(await rejectedTenant.json()).toEqual({
        error: "validation_failed",
      });

      const rejectedOrder = await handlers.post(
        post(null, null, randomUUID(), {
          question,
          orderId: "1001",
          userId: fixture.customerA,
        }),
      );
      expect(rejectedOrder.status).toBe(400);

      const rejectedHistory = await handlers.post(
        post(null, null, randomUUID(), {
          question,
          conversationId: randomUUID(),
        }),
      );
      expect(rejectedHistory.status).toBe(400);
      expect(await rejectedHistory.json()).toEqual({
        error: "history_not_allowed",
      });

      const created = await handlers.post(
        post(null, null, randomUUID(), { question }),
      );
      expect(created.status).toBe(201);
      const createdBody = (await created.json()) as {
        conversationId: string;
        isPrivate: boolean;
      };
      expect(createdBody.isPrivate).toBe(false);

      const [row] = await tx
        .select()
        .from(conversations)
        .where(eq(conversations.id, createdBody.conversationId));
      expect(row?.customerUserId).toBeNull();
      expect(row?.tenantId).toBe(fixture.tenantA);
      expect(row?.isPrivate).toBe(false);

      const anonymousRead = await handlers.read(
        new Request(
          `http://localhost:3000/api/v1/conversations/${createdBody.conversationId}`,
        ),
        {
          params: Promise.resolve({
            conversationId: createdBody.conversationId,
          }),
        },
      );
      expect(anonymousRead.status).toBe(200);

      const privateId = randomUUID();
      await tx.insert(conversations).values({
        id: privateId,
        tenantId: fixture.tenantA,
        customerUserId: fixture.customerA,
        isPrivate: true,
      });
      const hidden = await handlers.read(
        new Request(`http://localhost:3000/api/v1/conversations/${privateId}`),
        { params: Promise.resolve({ conversationId: privateId }) },
      );
      expect(hidden.status).toBe(404);

      const history = await handlers.list(
        new Request("http://localhost:3000/api/v1/conversations"),
      );
      expect(history.status).toBe(401);

      const events = await tx
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.tenantId, fixture.tenantA));
      expect(events).toEqual([]);
    });
  });

  it("limits new submits with a database counter and still replays the original", async () => {
    await withRollback(async (tx) => {
      const fixture = await seedFixture(tx);
      const handlers = handlersFor(tx, fixture, () => "answer", "1");
      const firstKey = randomUUID();
      const first = await handlers.post(
        post(fixture.tenantA, fixture.customerA, firstKey, { question }),
      );
      expect(first.status).toBe(201);
      const second = await handlers.post(
        post(fixture.tenantA, fixture.customerA, randomUUID(), {
          question: "One more question",
        }),
      );
      expect(second.status).toBe(429);
      expect(await second.json()).toEqual({ error: "rate_limited" });
      const replayed = await handlers.post(
        post(fixture.tenantA, fixture.customerA, firstKey, { question }),
      );
      expect(replayed.status).toBe(200);
      expect(await countConversations(tx, fixture.tenantA)).toBe(1);
    });
  });

  it("does not turn a rejected development identity into a public question", async () => {
    await withRollback(async (tx) => {
      const fixture = await seedFixture(tx);
      const handlers = createConversationHandlers({
        db: () => tx,
        embedder: () => fakeEmbedder(),
        chat: () => scriptedChat(fixture.chunkId, () => "answer"),
        retrievalSettings: () => ({ topK: 5, similarityThreshold: 0.3 }),
        now: () => new Date("2026-11-09T12:00:00.000Z"),
        env: {
          NODE_ENV: "test",
          SUPPORTPILOT_ALLOW_DEV_IDENTITY: "false",
          SUPPORTPILOT_PUBLIC_TENANT_SLUG: fixture.slug,
          SUPPORTPILOT_RATE_LIMIT_PER_MINUTE: "10",
        },
        accessDeps: accessFor(tx, {
          NODE_ENV: "test",
          SUPPORTPILOT_ALLOW_DEV_IDENTITY: "false",
        }),
      });
      const response = await handlers.post(
        post(null, fixture.customerA, randomUUID(), { question }),
      );
      expect(response.status).toBe(403);
      expect(await countConversations(tx, fixture.tenantA)).toBe(0);
    });
  });
});

type Fixture = {
  slug: string;
  tenantA: string;
  tenantB: string;
  customerA: string;
  customerB: string;
  chunkId: string;
};

async function seedFixture(tx: TenantQueryClient): Promise<Fixture> {
  const slug = `demo${randomUUID().slice(0, 8)}`;
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const customerA = seedUsers[3].id;
  const customerB = seedUsers[5].id;
  const chunkId = randomUUID();
  const documentA = randomUUID();
  const documentB = randomUUID();
  const [embedding] = await fakeEmbedder().embed([question]);
  if (!embedding) {
    throw new Error("missing embedding");
  }

  await tx.insert(tenants).values([
    { id: tenantA, slug, name: "Demo Goods" },
    { id: tenantB, slug: `other${randomUUID().slice(0, 8)}`, name: "Other" },
  ]);
  await tx
    .insert(users)
    .values([
      {
        id: seedUsers[3].id,
        email: seedUsers[3].email,
        displayName: seedUsers[3].displayName,
      },
      {
        id: seedUsers[5].id,
        email: seedUsers[5].email,
        displayName: seedUsers[5].displayName,
      },
    ])
    .onConflictDoNothing();
  const membershipA = randomUUID();
  const membershipB = randomUUID();
  await tx.insert(tenantMemberships).values([
    { id: membershipA, tenantId: tenantA, userId: customerA },
    { id: membershipB, tenantId: tenantA, userId: customerB },
  ]);
  await tx.insert(roleAssignments).values([
    { tenantId: tenantA, membershipId: membershipA, role: "customer" },
    { tenantId: tenantA, membershipId: membershipB, role: "customer" },
  ]);
  await tx.insert(documents).values([
    {
      id: documentA,
      tenantId: tenantA,
      title: "Shipping",
      source: "shipping.txt",
      documentType: "text",
      version: 1,
      publication: "published",
      checksum: "ab".repeat(32),
      body: excerpt,
      uploadedByUserId: customerA,
      ingestionStatus: "ready",
      isCurrent: true,
    },
    {
      id: documentB,
      tenantId: tenantB,
      title: "Aaa secret",
      source: "secret.txt",
      documentType: "text",
      version: 1,
      publication: "published",
      checksum: "cd".repeat(32),
      body: otherTenantText,
      uploadedByUserId: customerA,
      ingestionStatus: "ready",
      isCurrent: true,
    },
  ]);
  await tx.insert(documentChunks).values([
    {
      id: chunkId,
      tenantId: tenantA,
      documentId: documentA,
      documentVersion: 1,
      chunkIndex: 0,
      content: excerpt,
      embedding,
    },
    {
      tenantId: tenantB,
      documentId: documentB,
      documentVersion: 1,
      chunkIndex: 0,
      content: otherTenantText,
      embedding,
    },
  ]);
  return { slug, tenantA, tenantB, customerA, customerB, chunkId };
}

function handlersFor(
  tx: TenantQueryClient,
  fixture: Fixture,
  script: () => "answer" | "abstain" | "invented",
  limit: string,
) {
  const env = {
    NODE_ENV: "test",
    SUPPORTPILOT_ALLOW_DEV_IDENTITY: "true",
    SUPPORTPILOT_PUBLIC_TENANT_SLUG: fixture.slug,
    SUPPORTPILOT_RATE_LIMIT_PER_MINUTE: limit,
  };
  return createConversationHandlers({
    db: () => tx,
    embedder: () => fakeEmbedder(),
    chat: () => scriptedChat(fixture.chunkId, script),
    retrievalSettings: () => ({ topK: 5, similarityThreshold: 0.3 }),
    now: () => new Date("2026-11-09T12:00:00.000Z"),
    env,
    accessDeps: accessFor(tx, env),
  });
}

function scriptedChat(
  chunkId: string,
  script: () => "answer" | "abstain" | "invented",
): ChatProvider {
  return {
    model: "fixture-model",
    async complete() {
      const mode = script();
      const content =
        mode === "answer"
          ? {
              answer: answerText,
              citations: [{ chunkId }],
              abstained: false,
              conflict: false,
            }
          : mode === "abstain"
            ? {
                answer: "",
                citations: [],
                abstained: true,
                conflict: false,
              }
            : {
                answer: "This cites a chunk that was not retrieved.",
                citations: [{ chunkId: inventedChunkId }],
                abstained: false,
                conflict: false,
              };
      return {
        model: "fixture-model",
        content: JSON.stringify(content),
        usage: { inputTokens: 2, outputTokens: 2, totalTokens: 4 },
      };
    },
  };
}

function accessFor(
  tx: TenantQueryClient,
  env: Record<string, string | undefined>,
): AccessDeps {
  return {
    env,
    readSession: async () => null,
    findUserBySubject: async () => null,
    findMembership: (userId, tenantId) =>
      loadMembershipAccess(tx, userId, tenantId),
  };
}

function post(
  tenantId: string | null,
  userId: string | null,
  idempotencyKey: string,
  body: Record<string, unknown>,
  queryTenantId?: string,
): Request {
  const tenant = queryTenantId ?? tenantId;
  const url = new URL("http://localhost:3000/api/v1/support/messages");
  if (tenant && userId) {
    url.searchParams.set("tenantId", tenant);
  }
  if (!userId && queryTenantId) {
    url.searchParams.set("tenantId", queryTenantId);
  }
  const headers = new Headers({
    "content-type": "application/json",
    "idempotency-key": idempotencyKey,
  });
  if (userId) {
    headers.set(DEV_USER_HEADER, userId);
  }
  return new Request(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function getList(tenantId: string, userId: string): Request {
  const url = new URL("http://localhost:3000/api/v1/conversations");
  url.searchParams.set("tenantId", tenantId);
  return new Request(url, { headers: { [DEV_USER_HEADER]: userId } });
}

function getOne(
  tenantId: string,
  userId: string,
  conversationId: string,
): Request {
  const url = new URL(
    `http://localhost:3000/api/v1/conversations/${conversationId}`,
  );
  url.searchParams.set("tenantId", tenantId);
  return new Request(url, { headers: { [DEV_USER_HEADER]: userId } });
}

async function countConversations(
  tx: TenantQueryClient,
  tenantId: string,
): Promise<number> {
  const rows = await tx
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.tenantId, tenantId));
  return rows.length;
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
