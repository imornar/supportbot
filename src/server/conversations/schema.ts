import { z } from "zod";

import { maxQuestionChars } from "@/server/answers/schema";

/**
 * Fields a client may send on `POST /api/v1/support/messages`.
 * Tenant, user, order, and tool fields are not in this object. `.strict()`
 * rejects them. `conversationId` continues the caller's own private thread.
 * The logged-out route refuses that field.
 */
export const supportMessageBodySchema = z
  .object({
    question: z.string().trim().min(1).max(maxQuestionChars),
    conversationId: z.uuid().optional(),
  })
  .strict();

export type SupportMessageBody = z.infer<typeof supportMessageBodySchema>;

export const answerReasons = [
  "grounded",
  "no_evidence",
  "invalid_question",
  "invalid_evidence",
  "model_abstained",
  "invalid_output",
  "invented_citation",
  "uncited",
  "unresolved_conflict",
  "provider_error",
  "retrieval_failed",
  "clarification_needed",
  "customer_requested_human",
  "business_tool_unavailable",
  "workflow_failure",
  "order_lookup",
  "order_not_found",
  "order_unavailable",
  "sign_in_required",
] as const;

export type AnswerReason = (typeof answerReasons)[number];

export const citationValidations = [
  "passed",
  "failed",
  "not_applicable",
] as const;

export type CitationValidation = (typeof citationValidations)[number];

export const storedCitationSchema = z
  .object({
    chunkId: z.uuid(),
    documentId: z.uuid(),
    title: z.string().min(1).max(200),
    section: z.string().min(1).max(500).nullable(),
    excerpt: z.string().min(1).max(2000),
    documentVersion: z.number().int().positive(),
    effectiveDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
  })
  .strict();

export type StoredCitation = z.infer<typeof storedCitationSchema>;

export const messageResponseSchema = z
  .object({
    id: z.uuid(),
    role: z.enum(["user", "assistant"]),
    body: z.string(),
    outcome: z
      .enum(["answered", "clarified", "abstained", "escalated"])
      .nullable(),
    citations: z.array(storedCitationSchema),
    createdAt: z.string(),
  })
  .strict();

export const postMessageResponseSchema = z
  .object({
    conversationId: z.uuid(),
    isPrivate: z.boolean(),
    replayed: z.boolean(),
    messages: z.array(messageResponseSchema).length(2),
  })
  .strict();

export type PostMessageResponse = z.infer<typeof postMessageResponseSchema>;

export const conversationResponseSchema = z
  .object({
    id: z.uuid(),
    isPrivate: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

export const conversationDetailSchema = z
  .object({
    conversation: conversationResponseSchema,
    messages: z.array(messageResponseSchema),
  })
  .strict();

export const conversationListSchema = z
  .object({
    conversations: z.array(conversationResponseSchema),
  })
  .strict();

const modelIdPattern = /^[A-Za-z0-9._:-]{1,64}$/;

export function citationValidationFor(
  reason: AnswerReason,
): CitationValidation {
  if (reason === "grounded") {
    return "passed";
  }
  if (reason === "invented_citation" || reason === "uncited") {
    return "failed";
  }
  return "not_applicable";
}

export function storedModelId(model: string | null): string | null {
  if (!model || !modelIdPattern.test(model)) {
    return null;
  }
  return model;
}
