import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";

import { insertAuditEvent } from "@/server/db/audit";
import {
  conversations,
  messages,
  supportSubmissions,
} from "@/server/db/schema";
import type { TenantQueryClient } from "@/server/db/tenant-queries";

import type { PersistedAnswer } from "@/server/conversations/answer";
import {
  conversationDetailSchema,
  conversationListSchema,
  messageResponseSchema,
  postMessageResponseSchema,
  storedCitationSchema,
  type PostMessageResponse,
} from "@/server/conversations/schema";

const listLimit = 50;
const messageLimit = 200;

export class ConversationRequestError extends Error {
  readonly code:
    | "validation_failed"
    | "history_not_allowed"
    | "not_found"
    | "rate_limited"
    | "idempotency_in_progress"
    | "public_tenant_unavailable";

  constructor(code: ConversationRequestError["code"]) {
    super("Conversation request failed. Values are omitted.");
    this.name = "ConversationRequestError";
    this.code = code;
  }
}

export type SubmissionScope = {
  tenantId: string;
  customerUserId: string | null;
  idempotencyKey: string;
};

type SubmissionRow = {
  id: string;
  status: "pending" | "complete";
  conversationId: string | null;
  userMessageId: string | null;
  assistantMessageId: string | null;
};

export async function findSubmission(
  db: TenantQueryClient,
  scope: SubmissionScope,
): Promise<SubmissionRow | null> {
  const [row] = await db
    .select({
      id: supportSubmissions.id,
      status: supportSubmissions.status,
      conversationId: supportSubmissions.conversationId,
      userMessageId: supportSubmissions.userMessageId,
      assistantMessageId: supportSubmissions.assistantMessageId,
    })
    .from(supportSubmissions)
    .where(scopeFilter(scope))
    .limit(1);
  return row ?? null;
}

export async function claimSubmission(
  db: TenantQueryClient,
  scope: SubmissionScope,
): Promise<
  | { status: "claimed"; id: string }
  | { status: "pending" }
  | { status: "replay"; body: PostMessageResponse }
> {
  const inserted = await db
    .insert(supportSubmissions)
    .values({
      tenantId: scope.tenantId,
      customerUserId: scope.customerUserId,
      idempotencyKey: scope.idempotencyKey,
      status: "pending",
    })
    .onConflictDoNothing()
    .returning({ id: supportSubmissions.id });
  const claimed = inserted[0];
  if (claimed) {
    return { status: "claimed", id: claimed.id };
  }
  const existing = await findSubmission(db, scope);
  if (!existing || existing.status === "pending") {
    return { status: "pending" };
  }
  return { status: "replay", body: await replay(db, scope, existing) };
}

export async function releaseSubmission(
  db: TenantQueryClient,
  submissionId: string,
): Promise<void> {
  await db
    .delete(supportSubmissions)
    .where(
      and(
        eq(supportSubmissions.id, submissionId),
        eq(supportSubmissions.status, "pending"),
      ),
    );
}

export async function ownedPrivateConversation(
  db: TenantQueryClient,
  tenantId: string,
  customerUserId: string,
  conversationId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.tenantId, tenantId),
        eq(conversations.customerUserId, customerUserId),
        eq(conversations.isPrivate, true),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function completeSubmission(
  db: TenantQueryClient,
  input: {
    submissionId: string;
    scope: SubmissionScope;
    conversationId: string | null;
    question: string;
    answer: PersistedAnswer;
  },
): Promise<PostMessageResponse> {
  return db.transaction(async (tx) => {
    const conversationId = await conversationForTurn(tx, input);
    const now = new Date();
    const [userMessage] = await tx
      .insert(messages)
      .values({
        tenantId: input.scope.tenantId,
        conversationId,
        role: "user",
        body: input.question,
        citations: [],
      })
      .returning({
        id: messages.id,
        createdAt: messages.createdAt,
      });
    const [assistantMessage] = await tx
      .insert(messages)
      .values({
        tenantId: input.scope.tenantId,
        conversationId,
        role: "assistant",
        body: input.answer.body,
        outcome: input.answer.outcome,
        citationValidation: input.answer.citationValidation,
        modelId: input.answer.modelId,
        answerReason: input.answer.answerReason,
        workflowIntent: input.answer.intent,
        escalationReason: input.answer.escalationReason,
        citations: input.answer.citations,
      })
      .returning({
        id: messages.id,
        createdAt: messages.createdAt,
      });
    if (!userMessage || !assistantMessage) {
      throw new ConversationRequestError("idempotency_in_progress");
    }
    const updated = await tx
      .update(supportSubmissions)
      .set({
        status: "complete",
        conversationId,
        userMessageId: userMessage.id,
        assistantMessageId: assistantMessage.id,
        updatedAt: now,
      })
      .where(
        and(
          eq(supportSubmissions.id, input.submissionId),
          eq(supportSubmissions.status, "pending"),
          eq(supportSubmissions.tenantId, input.scope.tenantId),
        ),
      )
      .returning({ id: supportSubmissions.id });
    if (updated.length === 0) {
      throw new ConversationRequestError("idempotency_in_progress");
    }
    if (input.scope.customerUserId) {
      await insertAuditEvent(tx, {
        tenantId: input.scope.tenantId,
        actorUserId: input.scope.customerUserId,
        action: "conversation.answer",
        targetType: "conversation",
        targetId: conversationId,
      });
    }
    return postMessageResponseSchema.parse({
      conversationId,
      isPrivate: input.scope.customerUserId !== null,
      replayed: false,
      messages: [
        messageJson({
          id: userMessage.id,
          role: "user",
          body: input.question,
          outcome: null,
          citations: [],
          createdAt: userMessage.createdAt,
        }),
        messageJson({
          id: assistantMessage.id,
          role: "assistant",
          body: input.answer.body,
          outcome: input.answer.outcome,
          citations: input.answer.citations,
          createdAt: assistantMessage.createdAt,
        }),
      ],
    });
  });
}

export async function listOwnedConversations(
  db: TenantQueryClient,
  tenantId: string,
  customerUserId: string,
) {
  const rows = await db
    .select({
      id: conversations.id,
      isPrivate: conversations.isPrivate,
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
    })
    .from(conversations)
    .where(
      and(
        eq(conversations.tenantId, tenantId),
        eq(conversations.customerUserId, customerUserId),
        eq(conversations.isPrivate, true),
      ),
    )
    .orderBy(desc(conversations.updatedAt))
    .limit(listLimit);
  return conversationListSchema.parse({
    conversations: rows.map(conversationJson),
  });
}

export async function readPublicConversation(
  db: TenantQueryClient,
  conversationId: string,
) {
  const [row] = await db
    .select({ tenantId: conversations.tenantId })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.isPrivate, false),
      ),
    )
    .limit(1);
  if (!row) {
    return null;
  }
  return readConversation(db, {
    tenantId: row.tenantId,
    conversationId,
    customerUserId: null,
  });
}

export async function readConversation(
  db: TenantQueryClient,
  input: {
    tenantId: string;
    conversationId: string;
    customerUserId: string | null;
  },
) {
  const owner = input.customerUserId;
  const [conversation] = await db
    .select({
      id: conversations.id,
      isPrivate: conversations.isPrivate,
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
      customerUserId: conversations.customerUserId,
    })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, input.conversationId),
        eq(conversations.tenantId, input.tenantId),
        owner
          ? and(
              eq(conversations.customerUserId, owner),
              eq(conversations.isPrivate, true),
            )
          : eq(conversations.isPrivate, false),
      ),
    )
    .limit(1);
  if (!conversation) {
    return null;
  }
  const messageRows = await db
    .select({
      id: messages.id,
      role: messages.role,
      body: messages.body,
      outcome: messages.outcome,
      citations: messages.citations,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversation.id),
        eq(messages.tenantId, input.tenantId),
      ),
    )
    .orderBy(messages.createdAt)
    .limit(messageLimit);
  return conversationDetailSchema.parse({
    conversation: conversationJson(conversation),
    messages: messageRows.map((row) =>
      messageJson({
        id: row.id,
        role: row.role,
        body: row.body,
        outcome: row.outcome,
        citations: row.citations,
        createdAt: row.createdAt,
      }),
    ),
  });
}

export async function replay(
  db: TenantQueryClient,
  scope: SubmissionScope,
  existing: SubmissionRow,
): Promise<PostMessageResponse> {
  if (
    !existing.conversationId ||
    !existing.userMessageId ||
    !existing.assistantMessageId
  ) {
    throw new ConversationRequestError("idempotency_in_progress");
  }
  const [conversation] = await db
    .select({
      id: conversations.id,
      isPrivate: conversations.isPrivate,
      customerUserId: conversations.customerUserId,
    })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, existing.conversationId),
        eq(conversations.tenantId, scope.tenantId),
      ),
    )
    .limit(1);
  if (!conversation || conversation.customerUserId !== scope.customerUserId) {
    throw new ConversationRequestError("not_found");
  }
  const messageRows = await db
    .select({
      id: messages.id,
      role: messages.role,
      body: messages.body,
      outcome: messages.outcome,
      citations: messages.citations,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(
      and(
        eq(messages.tenantId, scope.tenantId),
        eq(messages.conversationId, conversation.id),
      ),
    );
  const userMessage = messageRows.find(
    (row) => row.id === existing.userMessageId,
  );
  const assistantMessage = messageRows.find(
    (row) => row.id === existing.assistantMessageId,
  );
  if (!userMessage || !assistantMessage) {
    throw new ConversationRequestError("not_found");
  }
  return postMessageResponseSchema.parse({
    conversationId: conversation.id,
    isPrivate: conversation.isPrivate,
    replayed: true,
    messages: [messageJson(userMessage), messageJson(assistantMessage)],
  });
}

async function conversationForTurn(
  db: TenantQueryClient,
  input: {
    scope: SubmissionScope;
    conversationId: string | null;
  },
): Promise<string> {
  if (input.conversationId) {
    if (!input.scope.customerUserId) {
      throw new ConversationRequestError("history_not_allowed");
    }
    const [existing] = await db
      .update(conversations)
      .set({ updatedAt: new Date() })
      .where(
        and(
          eq(conversations.id, input.conversationId),
          eq(conversations.tenantId, input.scope.tenantId),
          eq(conversations.customerUserId, input.scope.customerUserId),
          eq(conversations.isPrivate, true),
        ),
      )
      .returning({ id: conversations.id });
    if (!existing) {
      throw new ConversationRequestError("not_found");
    }
    return existing.id;
  }
  const [created] = await db
    .insert(conversations)
    .values({
      tenantId: input.scope.tenantId,
      customerUserId: input.scope.customerUserId,
      isPrivate: input.scope.customerUserId !== null,
    })
    .returning({ id: conversations.id });
  if (!created) {
    throw new ConversationRequestError("not_found");
  }
  return created.id;
}

function scopeFilter(scope: SubmissionScope) {
  return and(
    eq(supportSubmissions.tenantId, scope.tenantId),
    eq(supportSubmissions.idempotencyKey, scope.idempotencyKey),
    scope.customerUserId
      ? eq(supportSubmissions.customerUserId, scope.customerUserId)
      : isNull(supportSubmissions.customerUserId),
  );
}

function conversationJson(row: {
  id: string;
  isPrivate: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    isPrivate: row.isPrivate,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function messageJson(row: {
  id: string;
  role: "user" | "assistant";
  body: string;
  outcome: string | null;
  citations: unknown;
  createdAt: Date;
}) {
  const citations = storedCitationSchema.array().safeParse(row.citations);
  return messageResponseSchema.parse({
    id: row.id,
    role: row.role,
    body: row.body,
    outcome: row.outcome,
    citations: citations.success ? citations.data : [],
    createdAt: row.createdAt.toISOString(),
  });
}
