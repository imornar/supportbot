import "server-only";

import type { ChatProvider } from "@/server/answers/provider";
import type { Permission } from "@/server/auth/permissions";
import { embeddingDimensions } from "@/server/db/schema";
import type { EmbeddingProvider } from "@/server/documents/embed";
import type { TenantQueryClient } from "@/server/db/tenant-queries";
import { orderAccessForActor } from "@/server/orders/access";
import { createSessionOrderLookup } from "@/server/orders/lookup";
import { retrieveEvidence } from "@/server/retrieval/retrieve";
import type { RetrievalSettings } from "@/server/retrieval/settings";
import { fromGrounded, type PersistedAnswer } from "@/server/workflow/decision";
import { loadPublicSupportName } from "@/server/tenants/settings";
import { runSupportWorkflow } from "@/server/workflow/run";

export { fromGrounded, type PersistedAnswer };

/**
 * The handler has already authorized the tenant. This function closes over
 * that tenant id and the database client. The graph receives a retrieve
 * closure and, only for a customer with `order:read`, one order lookup
 * closure. It does not receive a connection string or a tool list.
 */
export async function answerSupportQuestion(input: {
  db: TenantQueryClient;
  embedder: EmbeddingProvider;
  chat: ChatProvider;
  settings: RetrievalSettings;
  tenantId: string;
  question: string;
  asOf: string;
  timeoutMs: number;
  actor:
    | {
        kind: "customer";
        userId: string;
        permissions: readonly Permission[];
      }
    | { kind: "anonymous" };
}): Promise<PersistedAnswer> {
  const supportName = await loadPublicSupportName(input.db, input.tenantId);
  const orderAccess = orderAccessForActor({
    kind: input.actor.kind,
    permissions: input.actor.kind === "customer" ? input.actor.permissions : [],
    lookup:
      input.actor.kind === "customer" &&
      input.actor.permissions.includes("order:read")
        ? createSessionOrderLookup(input.db, {
            tenantId: input.tenantId,
            userId: input.actor.userId,
          })
        : undefined,
  });
  return runSupportWorkflow({
    question: input.question,
    context: {
      tenantId: input.tenantId,
      asOf: input.asOf,
      timeoutMs: input.timeoutMs,
      chat: input.chat,
      retrieve: (question) => retrieveAuthorizedEvidence(input, question),
      orderAccess,
      supportName,
    },
  });
}

async function retrieveAuthorizedEvidence(
  input: {
    db: TenantQueryClient;
    embedder: EmbeddingProvider;
    settings: RetrievalSettings;
    tenantId: string;
    asOf: string;
  },
  question: string,
) {
  const vectors = await input.embedder.embed([question]);
  const embedding = vectors[0];
  if (!embedding || embedding.length !== embeddingDimensions) {
    throw new Error("Query embedding was rejected. Values are omitted.");
  }
  return retrieveEvidence(input.db, {
    tenantId: input.tenantId,
    embedding,
    settings: input.settings,
    asOf: input.asOf,
  });
}
