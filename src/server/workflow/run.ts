import "server-only";

import { GraphRecursionError } from "@langchain/langgraph";

import {
  workflowFailureDecision,
  type PersistedAnswer,
} from "@/server/workflow/decision";
import {
  createSupportWorkflow,
  type SupportWorkflowContext,
} from "@/server/workflow/graph";

/**
 * One classify, at most one retrieval, at most one judgment, then a terminal
 * node. Eight super-steps is above that path and still rejects a cycle.
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
  try {
    const { graph } = createSupportWorkflow(input.context.timeoutMs);
    const result = await graph.invoke(
      { question: input.question },
      {
        recursionLimit,
        context: input.context,
      },
    );
    return result.decision ?? workflowFailureDecision();
  } catch (error) {
    if (error instanceof GraphRecursionError) {
      return workflowFailureDecision();
    }
    return workflowFailureDecision();
  }
}
