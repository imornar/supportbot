import { z } from "zod";

/**
 * Client-side view of the support and ticket JSON.
 * A response that does not match is a failure. The page does not render it
 * as an answer, and it does not read fields the customer schema omits.
 */

export const ticketStatuses = [
  "open",
  "assigned",
  "in_progress",
  "resolved",
  "reopened",
  "closed",
] as const;

export type TicketStatus = (typeof ticketStatuses)[number];

export const assistantOutcomes = [
  "answered",
  "clarified",
  "abstained",
  "escalated",
] as const;

export type AssistantOutcome = (typeof assistantOutcomes)[number];

const citationSchema = z
  .object({
    chunkId: z.uuid(),
    documentId: z.uuid(),
    title: z.string(),
    section: z.string().nullable(),
    excerpt: z.string(),
    documentVersion: z.number(),
    effectiveDate: z.string().nullable(),
  })
  .strict();

export type ChatCitation = z.infer<typeof citationSchema>;

const chatMessageSchema = z
  .object({
    id: z.uuid(),
    role: z.enum(["user", "assistant"]),
    body: z.string(),
    outcome: z.enum(assistantOutcomes).nullable(),
    citations: z.array(citationSchema),
    createdAt: z.string(),
  })
  .strict();

export type ChatMessage = z.infer<typeof chatMessageSchema>;

const ticketSummarySchema = z
  .object({
    id: z.uuid(),
    status: z.enum(ticketStatuses),
    reason: z.string(),
    priority: z.string(),
  })
  .strict();

export type TicketSummary = z.infer<typeof ticketSummarySchema>;

export const postMessageResponseSchema = z
  .object({
    conversationId: z.uuid(),
    isPrivate: z.boolean(),
    replayed: z.boolean(),
    messages: z.array(chatMessageSchema).length(2),
    ticket: ticketSummarySchema.nullable(),
  })
  .strict();

export type PostMessageResponse = z.infer<typeof postMessageResponseSchema>;

const ticketReplySchema = z
  .object({
    id: z.uuid(),
    body: z.string(),
    createdAt: z.string(),
    authorUserId: z.uuid(),
  })
  .strict();

export const customerTicketSchema = z
  .object({
    id: z.uuid(),
    conversationId: z.uuid(),
    requesterUserId: z.uuid(),
    reason: z.string(),
    priority: z.string(),
    status: z.enum(ticketStatuses),
    assigneeUserId: z.uuid().nullable(),
    claimedAt: z.string().nullable(),
    resolvedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    citations: z.array(citationSchema),
    replies: z.array(ticketReplySchema),
  })
  .strict();

export type CustomerTicketView = z.infer<typeof customerTicketSchema>;

export const humanRequestQuestion = "I need to talk to a human";

const failureLead = "The request failed. This is not an answer.";

export function supportMessageUrl(tenantId: string | null): string {
  if (!tenantId) {
    return "/api/v1/support/messages";
  }
  const params = new URLSearchParams({ tenantId });
  return `/api/v1/support/messages?${params.toString()}`;
}

export function ticketUrl(ticketId: string, tenantId: string): string {
  const params = new URLSearchParams({ tenantId });
  return `/api/v1/tickets/${ticketId}?${params.toString()}`;
}

export function requestFailureCopy(code: string | null): string {
  switch (code) {
    case "rate_limited":
      return `${failureLead} Wait a minute and try again.`;
    case "unauthenticated":
      return `${failureLead} Sign in to continue.`;
    case "forbidden":
      return `${failureLead} This account cannot make that request.`;
    case "public_tenant_unavailable":
      return `${failureLead} Public questions are unavailable.`;
    case "validation_failed":
      return `${failureLead} Check the question and try again.`;
    default:
      return failureLead;
  }
}

export function assistantOutcomeCopy(
  outcome: AssistantOutcome | null,
): string | null {
  switch (outcome) {
    case "clarified":
      return "The assistant needs a more specific question.";
    case "abstained":
      return "The assistant could not answer from the available documents.";
    case "escalated":
      return "This was handed off for a person to review.";
    default:
      return null;
  }
}

/**
 * Only a claimed ticket says a person accepted it.
 * `open` and `reopened` are still waiting. Resolved and closed describe
 * the ticket without inventing an acceptance the status does not name.
 */
export function ticketStatusCopy(status: TicketStatus): string {
  switch (status) {
    case "open":
      return "Waiting for a support agent.";
    case "reopened":
      return "Waiting for a support agent again.";
    case "assigned":
      return "A support agent has accepted this request.";
    case "in_progress":
      return "A support agent has accepted this request and is working on it.";
    case "resolved":
      return "This request is resolved.";
    case "closed":
      return "This request is closed.";
  }
}

export function appendTurn(
  current: readonly ChatMessage[],
  incoming: readonly ChatMessage[],
): ChatMessage[] {
  const seen = new Set(current.map((message) => message.id));
  const next = [...current];
  for (const message of incoming) {
    if (seen.has(message.id)) {
      continue;
    }
    seen.add(message.id);
    next.push(message);
  }
  return next;
}

export type ChatRequestResult =
  { ok: true; body: PostMessageResponse } | { ok: false; message: string };

export async function postSupportMessage(
  input: {
    tenantId: string | null;
    question: string;
    conversationId: string | null;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<ChatRequestResult> {
  return readChatResponse(
    () =>
      fetchImpl(supportMessageUrl(input.tenantId), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          question: input.question,
          ...(input.conversationId
            ? { conversationId: input.conversationId }
            : {}),
        }),
      }),
    (payload) => postMessageResponseSchema.safeParse(payload),
  );
}

export type TicketRequestResult =
  { ok: true; ticket: CustomerTicketView } | { ok: false; message: string };

export async function readTicket(
  input: { ticketId: string; tenantId: string },
  fetchImpl: typeof fetch = fetch,
): Promise<TicketRequestResult> {
  const result = await readChatResponse(
    () => fetchImpl(ticketUrl(input.ticketId, input.tenantId)),
    (payload) => customerTicketSchema.safeParse(payload),
  );
  if (!result.ok) {
    return result;
  }
  return { ok: true, ticket: result.body };
}

async function readChatResponse<T>(
  send: () => Promise<Response>,
  parse: (payload: unknown) => { success: true; data: T } | { success: false },
): Promise<{ ok: true; body: T } | { ok: false; message: string }> {
  let response: Response;
  try {
    response = await send();
  } catch {
    return { ok: false, message: requestFailureCopy(null) };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, message: requestFailureCopy(null) };
  }

  if (!response.ok) {
    const code =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : null;
    return { ok: false, message: requestFailureCopy(code) };
  }

  const parsed = parse(payload);
  if (!parsed.success) {
    return { ok: false, message: requestFailureCopy(null) };
  }
  return { ok: true, body: parsed.data };
}
