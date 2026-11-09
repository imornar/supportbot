import "server-only";

import { GraphRecursionError } from "@langchain/langgraph";

import {
  defaultSupportName,
  isPublicSupportName,
  workflowFailureDecision,
  type PersistedAnswer,
} from "@/server/workflow/decision";
import {
  createSupportWorkflow,
  type SupportWorkflowContext,
} from "@/server/workflow/graph";

/**
 * One classify, then either a lookup, a clarification, an escalation, or
 * retrieval plus judgment. Eight super-steps is above that path and still
 * rejects a cycle.
 */
export const workflowRecursionLimit = 8;

export async function runSupportWorkflow(input: {
  question: string;
  context: SupportWorkflowContext;
  recursionLimit?: number;
}): Promise<PersistedAnswer> {
  const requested = input.recursionLimit ?? workflowRecursionLimit;
  const recursionLimit =
    Number.isInteger(requested) &&
    requested > 0 &&
    requested <= workflowRecursionLimit
      ? requested
      : workflowRecursionLimit;
  const supportName = isPublicSupportName(input.context.supportName)
    ? input.context.supportName
    : defaultSupportName;
  try {
    const { graph } = createSupportWorkflow(input.context.timeoutMs);
    const result = await graph.invoke(
      { question: input.question },
      {
        recursionLimit,
        context: input.context,
      },
    );
    return result.decision ?? workflowFailureDecision("ordinary", supportName);
  } catch (error) {
    if (error instanceof GraphRecursionError) {
      return workflowFailureDecision("ordinary", supportName);
    }
    return workflowFailureDecision("ordinary", supportName);
  }
}
