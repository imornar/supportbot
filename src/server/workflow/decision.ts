import "server-only";

import {
  unavailableMessage,
  type GroundedAnswer,
} from "@/server/answers/generate";
import {
  citationValidationFor,
  storedCitationSchema,
  storedModelId,
  type AnswerReason,
  type CitationValidation,
  type StoredCitation,
} from "@/server/conversations/schema";

import type { WorkflowIntent } from "@/server/workflow/intent";

export const escalationReasons = [
  "customer_requested_human",
  "business_tool_unavailable",
  "workflow_failure",
] as const;

export type EscalationReason = (typeof escalationReasons)[number];

export const workflowOutcomes = [
  "answered",
  "clarified",
  "abstained",
  "escalated",
] as const;

export type WorkflowOutcome = (typeof workflowOutcomes)[number];

export const humanEscalationMessage =
  "You asked for a person. A support agent has not accepted this yet.";

export const orderEscalationMessage =
  "I can't look up an order yet. A support agent has not accepted this yet.";

export const workflowFailureMessage =
  "I can't complete that request. A support agent has not accepted this yet.";

export const clarificationMessage =
  "Could you share a bit more about what you want to know?";

export type PersistedAnswer = {
  outcome: WorkflowOutcome;
  body: string;
  citations: StoredCitation[];
  citationValidation: CitationValidation;
  modelId: string | null;
  answerReason: AnswerReason;
  intent: WorkflowIntent;
  escalationReason: EscalationReason | null;
};

export function fromGrounded(
  answer: GroundedAnswer,
  intent: WorkflowIntent = "ordinary",
): PersistedAnswer {
  const reason = answer.reason;
  const validation = citationValidationFor(reason);
  const citations =
    validation === "passed" ? acceptCitations(answer.citations) : [];
  if (validation === "passed" && citations === null) {
    return failedRetrieval(intent);
  }
  const body = answer.answer.trim();
  if (body.length === 0 || body.length > 4_000) {
    return failedRetrieval(intent);
  }
  return {
    outcome: reason === "grounded" ? "answered" : "abstained",
    body,
    citations: citations ?? [],
    citationValidation: validation,
    modelId: storedModelId(answer.model),
    answerReason: reason,
    intent,
    escalationReason: null,
  };
}

export function clarificationDecision(intent: WorkflowIntent): PersistedAnswer {
  return {
    outcome: "clarified",
    body: clarificationMessage,
    citations: [],
    citationValidation: "not_applicable",
    modelId: null,
    answerReason: "clarification_needed",
    intent,
    escalationReason: null,
  };
}

export function escalationDecision(
  intent: WorkflowIntent,
  reason: EscalationReason,
  body: string,
): PersistedAnswer {
  return {
    outcome: "escalated",
    body,
    citations: [],
    citationValidation: "not_applicable",
    modelId: null,
    answerReason: reason,
    intent,
    escalationReason: reason,
  };
}

export function retrievalFailureDecision(): PersistedAnswer {
  return {
    outcome: "abstained",
    body: unavailableMessage,
    citations: [],
    citationValidation: "not_applicable",
    modelId: null,
    answerReason: "retrieval_failed",
    intent: "ordinary",
    escalationReason: null,
  };
}

export function workflowFailureDecision(): PersistedAnswer {
  return escalationDecision(
    "ordinary",
    "workflow_failure",
    workflowFailureMessage,
  );
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

function failedRetrieval(intent: WorkflowIntent): PersistedAnswer {
  return {
    outcome: "abstained",
    body: unavailableMessage,
    citations: [],
    citationValidation: "not_applicable",
    modelId: null,
    answerReason: "retrieval_failed",
    intent,
    escalationReason: null,
  };
}
