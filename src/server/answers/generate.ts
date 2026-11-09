import "server-only";

import { validateCitations } from "@/server/answers/citations";
import type { PublicCitation } from "@/server/answers/citations";
import { resolveEvidencePrecedence } from "@/server/answers/precedence";
import { buildGroundedMessages } from "@/server/answers/prompt";
import type { ChatProvider, TokenUsage } from "@/server/answers/provider";
import {
  maxQuestionChars,
  minimumCitationCount,
  modelAnswerSchema,
} from "@/server/answers/schema";
import { maxRetrievalTopK } from "@/server/retrieval/settings";
import type { RetrievedEvidence } from "@/server/retrieval/retrieve";

const insufficientEvidenceMessage =
  "I don't have enough published information to answer that.";
const unavailableMessage = "I can't answer right now. Please try again later.";

export type GroundedAnswerReason =
  | "grounded"
  | "no_evidence"
  | "invalid_question"
  | "invalid_evidence"
  | "model_abstained"
  | "invalid_output"
  | "invented_citation"
  | "uncited"
  | "unresolved_conflict"
  | "provider_error";

export type GroundedAnswer = {
  outcome: "answered" | "abstained";
  answer: string;
  citations: PublicCitation[];
  abstained: boolean;
  conflict: boolean;
  conflictResolved: boolean;
  reason: GroundedAnswerReason;
  model: string | null;
  usage: TokenUsage | null;
};

/**
 * `conflict: false` means the model did not report a disagreement. Two
 * documents can support one answer, which is the retrieval dataset's
 * multi-source case, so extra documents are not treated as a conflict by
 * themselves. To abstain whenever more than one document is present, run
 * `resolveEvidencePrecedence` for `conflict: false` as well and abstain on
 * `unresolved`. That is safer and refuses some answers that have support.
 */
export async function generateGroundedAnswer(
  input: {
    question: string;
    evidence: readonly RetrievedEvidence[];
  },
  provider: ChatProvider,
): Promise<GroundedAnswer> {
  const question = input.question.trim();
  if (question.length === 0 || question.length > maxQuestionChars) {
    return abstained("invalid_question");
  }
  if (input.evidence.length === 0) {
    return abstained("no_evidence");
  }
  if (!evidenceIsUsable(input.evidence)) {
    return abstained("invalid_evidence");
  }

  let completion: Awaited<ReturnType<ChatProvider["complete"]>>;
  try {
    completion = await provider.complete({
      messages: buildGroundedMessages(question, input.evidence),
    });
  } catch {
    return abstained("provider_error", { model: provider.model });
  }

  const model = completion.model || provider.model;
  const usage = completion.usage;
  const parsed = modelAnswerSchema.safeParse(readJson(completion.content));
  if (!parsed.success) {
    return abstained("invalid_output", { model, usage });
  }

  const modelAnswer = parsed.data;
  if (modelAnswer.abstained) {
    return abstained("model_abstained", {
      model,
      usage,
      conflict: modelAnswer.conflict,
    });
  }

  const citationCheck = validateCitations(
    modelAnswer.citations,
    input.evidence,
  );
  if (!citationCheck.ok) {
    return abstained("invented_citation", {
      model,
      usage,
      conflict: modelAnswer.conflict,
    });
  }
  if (citationCheck.citations.length < minimumCitationCount) {
    return abstained("uncited", {
      model,
      usage,
      conflict: modelAnswer.conflict,
    });
  }

  if (modelAnswer.conflict) {
    const precedence = resolveEvidencePrecedence(input.evidence);
    const citesWinner =
      precedence.status === "winner" &&
      citationCheck.citations.every(
        (citation) => citation.documentId === precedence.documentId,
      );
    if (citesWinner) {
      return {
        outcome: "answered",
        answer: modelAnswer.answer.trim(),
        citations: citationCheck.citations,
        abstained: false,
        conflict: true,
        conflictResolved: true,
        reason: "grounded",
        model,
        usage,
      };
    }
    return abstained("unresolved_conflict", {
      model,
      usage,
      conflict: true,
    });
  }

  return {
    outcome: "answered",
    answer: modelAnswer.answer.trim(),
    citations: citationCheck.citations,
    abstained: false,
    conflict: false,
    conflictResolved: false,
    reason: "grounded",
    model,
    usage,
  };
}

function evidenceIsUsable(evidence: readonly RetrievedEvidence[]): boolean {
  if (evidence.length > maxRetrievalTopK) {
    return false;
  }
  const tenantIds = new Set(evidence.map((item) => item.tenantId));
  if (tenantIds.size !== 1) {
    return false;
  }
  return evidence.every(
    (item) => item.chunkId.length > 0 && item.text.length > 0,
  );
}

function readJson(content: string | null): unknown {
  if (content === null) {
    return null;
  }
  try {
    return JSON.parse(content) as unknown;
  } catch {
    return null;
  }
}

function abstained(
  reason: Exclude<GroundedAnswerReason, "grounded">,
  extra?: {
    model?: string | null;
    usage?: TokenUsage | null;
    conflict?: boolean;
  },
): GroundedAnswer {
  return {
    outcome: "abstained",
    answer:
      reason === "provider_error"
        ? unavailableMessage
        : insufficientEvidenceMessage,
    citations: [],
    abstained: true,
    conflict: extra?.conflict ?? false,
    conflictResolved: false,
    reason,
    model: extra?.model ?? null,
    usage: extra?.usage ?? null,
  };
}
