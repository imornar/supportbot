import { z } from "zod";

import {
  accessErrorResponse,
  type AccessDeps,
  defaultAccessDeps,
} from "@/server/auth/access";
import { getDb } from "@/server/db/client";
import type { TenantQueryClient } from "@/server/db/tenant-queries";
import {
  createEmbeddingProvider,
  type EmbeddingProvider,
} from "@/server/documents/embed";
import {
  createChatProvider,
  parseChatTimeoutMs,
} from "@/server/answers/provider";
import type { ChatProvider } from "@/server/answers/provider";
import {
  getRetrievalSettings,
  type RetrievalSettings,
} from "@/server/retrieval/settings";

import {
  loadPublicTenantId,
  resolveSupportActor,
  type SupportActor,
} from "@/server/conversations/actor";
import { answerSupportQuestion } from "@/server/conversations/answer";
import {
  consumeSupportRateLimit,
  parseRateLimitPerMinute,
  supportRateBucketKey,
} from "@/server/conversations/rate-limit";
import { supportMessageBodySchema } from "@/server/conversations/schema";
import {
  claimSubmission,
  completeSubmission,
  ConversationRequestError,
  findSubmission,
  listOwnedConversations,
  ownedPrivateConversation,
  readConversation,
  readPublicConversation,
  releaseSubmission,
  replay,
  type SubmissionScope,
} from "@/server/conversations/store";

const maxBodyBytes = 16 * 1024;

export type ConversationHandlerDeps = {
  accessDeps?: AccessDeps;
  db: () => TenantQueryClient;
  embedder: () => EmbeddingProvider;
  chat: () => ChatProvider;
  retrievalSettings: () => RetrievalSettings;
  now: () => Date;
  env: Record<string, string | undefined>;
};

export function createConversationHandlers(
  overrides?: Partial<ConversationHandlerDeps>,
) {
  const deps: ConversationHandlerDeps = {
    db: getDb,
    embedder: () => createEmbeddingProvider(process.env),
    chat: () => createChatProvider(process.env),
    retrievalSettings: getRetrievalSettings,
    now: () => new Date(),
    env: process.env,
    ...overrides,
  };

  return {
    async post(request: Request): Promise<Response> {
      return guard(async () => {
        const body = await readJson(request);
        if (body instanceof Response) {
          return body;
        }
        const idempotencyKey = readIdempotencyKey(request);
        if (idempotencyKey instanceof Response) {
          return idempotencyKey;
        }
        const db = deps.db();
        const actor = await resolveSupportActor(
          request,
          "conversation:create",
          accessDeps(deps),
          "customer-or-public",
        );
        const scope = await submissionScope(db, actor, idempotencyKey, deps);
        const existing = await findSubmission(db, scope);
        if (existing?.status === "complete") {
          const replayed = await replay(db, scope, existing);
          return Response.json(replayed);
        }
        if (existing?.status === "pending") {
          throw new ConversationRequestError("idempotency_in_progress");
        }
        if (actor.kind === "anonymous" && body.conversationId) {
          throw new ConversationRequestError("history_not_allowed");
        }
        if (actor.kind === "customer" && body.conversationId) {
          const owned = await ownedPrivateConversation(
            db,
            actor.tenantId,
            actor.userId,
            body.conversationId,
          );
          if (!owned) {
            throw new ConversationRequestError("not_found");
          }
        }

        const claim = await claimSubmission(db, scope);
        if (claim.status === "replay") {
          return Response.json(claim.body);
        }
        if (claim.status === "pending") {
          throw new ConversationRequestError("idempotency_in_progress");
        }

        try {
          const allowed = await consumeSupportRateLimit(
            db,
            supportRateBucketKey({
              tenantId: scope.tenantId,
              userId: scope.customerUserId,
              forwardedFor: request.headers.get("x-forwarded-for"),
            }),
            parseRateLimitPerMinute(deps.env),
          );
          if (!allowed) {
            await releaseSubmission(db, claim.id);
            throw new ConversationRequestError("rate_limited");
          }
          const answer = await answerSupportQuestion({
            db,
            embedder: deps.embedder(),
            chat: deps.chat(),
            settings: deps.retrievalSettings(),
            tenantId: scope.tenantId,
            question: body.question,
            asOf: isoDate(deps.now()),
            timeoutMs: parseChatTimeoutMs(deps.env),
          });
          const stored = await completeSubmission(db, {
            submissionId: claim.id,
            scope,
            conversationId: body.conversationId ?? null,
            question: body.question,
            answer,
          });
          return Response.json(stored, { status: 201 });
        } catch (error) {
          await releaseSubmission(db, claim.id);
          throw error;
        }
      });
    },

    async list(request: Request): Promise<Response> {
      return guard(async () => {
        const db = deps.db();
        const actor = await resolveSupportActor(
          request,
          "conversation:read",
          accessDeps(deps),
          "customer",
        );
        if (actor.kind !== "customer") {
          throw new ConversationRequestError("not_found");
        }
        const conversations = await listOwnedConversations(
          db,
          actor.tenantId,
          actor.userId,
        );
        return Response.json(conversations);
      });
    },

    async read(
      request: Request,
      context: { params: Promise<{ conversationId: string }> },
    ): Promise<Response> {
      return guard(async () => {
        const conversationId = await conversationIdFrom(context);
        if (conversationId instanceof Response) {
          return conversationId;
        }
        const db = deps.db();
        const actor = await resolveSupportActor(
          request,
          "conversation:read",
          accessDeps(deps),
          "customer-or-public",
        );
        const detail =
          actor.kind === "customer"
            ? await readConversation(db, {
                tenantId: actor.tenantId,
                conversationId,
                customerUserId: actor.userId,
              })
            : await readPublicConversation(db, conversationId);
        if (!detail) {
          throw new ConversationRequestError("not_found");
        }
        return Response.json(detail);
      });
    },
  };
}

function accessDeps(deps: ConversationHandlerDeps): AccessDeps {
  return deps.accessDeps ?? defaultAccessDeps();
}

async function submissionScope(
  db: TenantQueryClient,
  actor: SupportActor,
  idempotencyKey: string,
  deps: ConversationHandlerDeps,
): Promise<SubmissionScope> {
  if (actor.kind === "customer") {
    return {
      tenantId: actor.tenantId,
      customerUserId: actor.userId,
      idempotencyKey,
    };
  }
  return {
    tenantId: await loadPublicTenantId(db, deps.env),
    customerUserId: null,
    idempotencyKey,
  };
}

async function guard(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    const response = conversationErrorResponse(error);
    if (response) {
      return response;
    }
    console.error("support request failed");
    return Response.json({ error: "support_failed" }, { status: 500 });
  }
}

export function conversationErrorResponse(error: unknown): Response | null {
  const access = accessErrorResponse(error);
  if (access) {
    return access;
  }
  if (error instanceof ConversationRequestError) {
    return Response.json(
      { error: error.code },
      { status: statusFor(error.code) },
    );
  }
  return null;
}

function statusFor(code: ConversationRequestError["code"]): number {
  switch (code) {
    case "validation_failed":
    case "history_not_allowed":
      return 400;
    case "not_found":
      return 404;
    case "rate_limited":
      return 429;
    case "idempotency_in_progress":
      return 409;
    case "public_tenant_unavailable":
      return 503;
  }
}

async function readJson(
  request: Request,
): Promise<z.infer<typeof supportMessageBodySchema> | Response> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBodyBytes) {
    return Response.json({ error: "payload_too_large" }, { status: 413 });
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > maxBodyBytes) {
    return Response.json({ error: "payload_too_large" }, { status: 413 });
  }
  try {
    const parsed = supportMessageBodySchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      return Response.json({ error: "validation_failed" }, { status: 400 });
    }
    return parsed.data;
  } catch {
    return Response.json({ error: "validation_failed" }, { status: 400 });
  }
}

function readIdempotencyKey(request: Request): string | Response {
  const key = request.headers.get("idempotency-key")?.trim().toLowerCase();
  if (!key || !z.uuid().safeParse(key).success) {
    return Response.json({ error: "validation_failed" }, { status: 400 });
  }
  return key;
}

async function conversationIdFrom(context: {
  params: Promise<{ conversationId: string }>;
}): Promise<string | Response> {
  const { conversationId } = await context.params;
  const parsed = conversationId.trim().toLowerCase();
  if (!z.uuid().safeParse(parsed).success) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  return parsed;
}

function isoDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}
