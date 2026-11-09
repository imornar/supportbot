import "server-only";

export const workflowIntents = [
  "human_request",
  "possible_order",
  "ordinary",
  "needs_clarification",
] as const;

export type WorkflowIntent = (typeof workflowIntents)[number];

/**
 * Lexical rules for the branches tests have to hit. A model classifier can be
 * talked out of "talk to a human", so these phrases stay deterministic.
 * Human wins over an order phrase in the same message. A greeting is a
 * clarification only when the whole question is that greeting.
 */
const humanRequestPattern =
  /\b(?:talk|speak|chat)\s+to\s+(?:a|an)?\s*(?:human|person|someone|agent|representative)\b|\b(?:human|live)\s+(?:agent|person)\b|\breal person\b|\bcustomer service\b/i;

const orderQuestionPattern =
  /\bmy order\b|\border\s+(?:number|status|id)\b|\border\s*#\s*\d+\b|\border\s+\d+\b|\b(?:track|tracking)\s+(?:my\s+)?order\b|\bwhere\s+is\s+(?:my\s+)?order\b/i;

const clarificationPattern =
  /^(?:hi|hello|hey|help|help me|i need help|i have a question)[.!?]*$/i;

export function classifySupportQuestion(question: string): WorkflowIntent {
  const text = question.trim();
  if (humanRequestPattern.test(text)) {
    return "human_request";
  }
  if (orderQuestionPattern.test(text)) {
    return "possible_order";
  }
  if (clarificationPattern.test(text)) {
    return "needs_clarification";
  }
  return "ordinary";
}
