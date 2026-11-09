import "server-only";

import type { GroundedAnswer } from "@/server/answers/generate";
import { generateGroundedAnswer } from "@/server/answers/generate";
import type { ChatProvider } from "@/server/answers/provider";
import type { EmbeddingProvider } from "@/server/documents/embed";
import { embeddingDimensions } from "@/server/db/schema";
import type { TenantQueryClient } from "@/server/db/tenant-queries";
import { retrieveEvidence } from "@/server/retrieval/retrieve";
import type { RetrievalSettings } from "@/server/retrieval/settings";

import {
  citationValidationFor,
  storedCitationSchema,
  storedModelId,
  type AnswerReason,
  type CitationValidation,
  type StoredCitation,
} from "@/server/conversations/schema";

const unavailableMessage = "I can't answer right now. Please try again later.";

export type PersistedAnswer = {
  outcome: "answered" | "abstained";
  body: string;
  citations: StoredCitation[];
  citationValidation: CitationValidation;
  modelId: string | null;
  answerReason: AnswerReason;
};

/**
 * Retrieval uses the tenant id the handler already resolved. The model sees
 * the question and that evidence only. Embedding and retrieval failures become
 * an abstention with a fixed sentence. The provider error text is not stored.
 */
export async function answerSupportQuestion(input: {
  db: TenantQueryClient;
  embedder: EmbeddingProvider;
  chat: ChatProvider;
  settings: RetrievalSettings;
  tenantId: string;
  question: string;
  asOf: string;
}): Promise<PersistedAnswer> {
  let embedding: number[] | undefined;
  try {
    const vectors = await input.embedder.embed([input.question]);
    embedding = vectors[0];
  } catch {
    return failedRetrieval();
  }
  if (!embedding || embedding.length !== embeddingDimensions) {
    return failedRetrieval();
  }

  try {
    const evidence = await retrieveEvidence(input.db, {
      tenantId: input.tenantId,
      embedding,
      settings: input.settings,
      asOf: input.asOf,
    });
    const grounded = await generateGroundedAnswer(
      { question: input.question, evidence },
      input.chat,
    );
    return fromGrounded(grounded);
  } catch {
    return failedRetrieval();
  }
}

export function fromGrounded(answer: GroundedAnswer): PersistedAnswer {
  const reason = answer.reason;
  const validation = citationValidationFor(reason);
  const citations =
    validation === "passed" ? acceptCitations(answer.citations) : [];
  if (validation === "passed" && citations === null) {
    return failedRetrieval();
  }
  const body = answer.answer.trim();
  if (body.length === 0 || body.length > 4_000) {
    return failedRetrieval();
  }
  return {
    outcome: reason === "grounded" ? "answered" : "abstained",
    body,
    citations: citations ?? [],
    citationValidation: validation,
    modelId: storedModelId(answer.model),
    answerReason: reason,
  };
}

function acceptCitations(
  citations: GroundedAnswer["citations"],
): StoredCitation[] | null {
  const parsed = storedCitationSchema.array().safeParse(citations);
  if (!parsed.success) {
    return null;
  }
  return parsed.data;
}

function failedRetrieval(): PersistedAnswer {
  return {
    outcome: "abstained",
    body: unavailableMessage,
    citations: [],
    citationValidation: "not_applicable",
    modelId: null,
    answerReason: "retrieval_failed",
  };
}
