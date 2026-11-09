import "server-only";

/**
 * Text a later model call may see for one ticket. Notes are not a parameter.
 * Callers pass conversation lines and customer-visible replies only.
 */
export function buildTicketModelContext(input: {
  reason: string;
  status: string;
  conversation: { role: "user" | "assistant"; body: string }[];
  customerReplies: { body: string }[];
}): string {
  const lines = [
    `Reason: ${input.reason}`,
    `Status: ${input.status}`,
    "Conversation:",
    ...input.conversation.map((message) => `${message.role}: ${message.body}`),
    "Replies:",
    ...input.customerReplies.map((reply) => `agent: ${reply.body}`),
  ];
  return lines.join("\n");
}
