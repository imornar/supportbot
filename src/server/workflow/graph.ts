import "server-only";

import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

import {
  generateGroundedAnswer,
  ungroundedAnswer,
  type GroundedAnswer,
} from "@/server/answers/generate";
import type { ChatProvider } from "@/server/answers/provider";
import type { RetrievedEvidence } from "@/server/retrieval/retrieve";

import {
  clarificationDecision,
  escalationDecision,
  fromGrounded,
  humanEscalationMessage,
  orderEscalationMessage,
  retrievalFailureDecision,
  workflowFailureDecision,
  type PersistedAnswer,
} from "@/server/workflow/decision";
import {
  classifySupportQuestion,
  type WorkflowIntent,
} from "@/server/workflow/intent";
import { withTimeout } from "@/server/workflow/timeout";

/**
 * Closed list. There is no tool node and no path that reads a model-chosen
 * tool name. `possible_order` escalates until Step 10 replaces that arm.
 */
export const supportWorkflowNodeNames = [
  "classify",
  "retrieve",
  "judge",
  "answer",
  "clarify",
  "abstain",
  "escalate",
] as const;

export type SupportWorkflowNodeName = (typeof supportWorkflowNodeNames)[number];

const nodeTimeoutBufferMs = 1_000;

export type SupportWorkflowContext = {
  tenantId: string;
  asOf: string;
  timeoutMs: number;
  chat: ChatProvider;
  retrieve: (question: string) => Promise<RetrievedEvidence[]>;
};

type RetrievalStatus = "ok" | "empty" | "failed";

const SupportWorkflowState = Annotation.Root({
  question: Annotation<string>,
  intent: Annotation<WorkflowIntent | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
  retrieval: Annotation<RetrievalStatus | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
  evidence: Annotation<RetrievedEvidence[]>({
    reducer: (_current, update) => update,
    default: () => [],
  }),
  grounded: Annotation<GroundedAnswer | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
  decision: Annotation<PersistedAnswer | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
});

type WorkflowState = typeof SupportWorkflowState.State;

type NodeConfig = {
  context?: unknown;
  signal?: AbortSignal;
};

export function routeAfterClassify(
  state: Pick<WorkflowState, "intent">,
): "escalate" | "clarify" | "retrieve" {
  if (state.intent === "human_request" || state.intent === "possible_order") {
    return "escalate";
  }
  if (state.intent === "needs_clarification") {
    return "clarify";
  }
  return "retrieve";
}

export function routeAfterRetrieve(
  state: Pick<WorkflowState, "retrieval">,
): "judge" | "abstain" {
  if (state.retrieval === "ok") {
    return "judge";
  }
  return "abstain";
}

export function routeAfterJudge(
  state: Pick<WorkflowState, "grounded">,
): "answer" | "abstain" {
  if (state.grounded?.reason === "grounded") {
    return "answer";
  }
  return "abstain";
}

function readContext(config: NodeConfig): SupportWorkflowContext {
  if (!isWorkflowContext(config.context)) {
    throw new Error("Support workflow context is missing.");
  }
  return config.context;
}

function isWorkflowContext(value: unknown): value is SupportWorkflowContext {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as SupportWorkflowContext;
  return (
    typeof candidate.tenantId === "string" &&
    typeof candidate.asOf === "string" &&
    typeof candidate.timeoutMs === "number" &&
    typeof candidate.retrieve === "function" &&
    typeof candidate.chat?.complete === "function"
  );
}

async function classifyNode(state: WorkflowState) {
  return { intent: classifySupportQuestion(state.question) };
}

async function retrieveNode(state: WorkflowState, config: NodeConfig) {
  const context = readContext(config);
  try {
    const evidence = await withTimeout(
      context.retrieve(state.question),
      context.timeoutMs,
      config.signal,
    );
    if (evidence.length === 0) {
      return {
        retrieval: "empty" as const,
        evidence: [],
        grounded: ungroundedAnswer("no_evidence"),
      };
    }
    return { retrieval: "ok" as const, evidence };
  } catch {
    return {
      retrieval: "failed" as const,
      evidence: [],
      grounded: null,
    };
  }
}

async function judgeNode(state: WorkflowState, config: NodeConfig) {
  const context = readContext(config);
  try {
    const grounded = await withTimeout(
      generateGroundedAnswer(
        { question: state.question, evidence: state.evidence },
        context.chat,
      ),
      context.timeoutMs,
      config.signal,
    );
    return { grounded };
  } catch {
    return {
      grounded: ungroundedAnswer("provider_error", {
        model: context.chat.model,
      }),
    };
  }
}

function answerNode(state: WorkflowState) {
  if (!state.grounded || state.intent !== "ordinary") {
    return {
      decision: fromGrounded(ungroundedAnswer("invalid_output"), "ordinary"),
    };
  }
  return { decision: fromGrounded(state.grounded, "ordinary") };
}

function clarifyNode() {
  return { decision: clarificationDecision("needs_clarification") };
}

function abstainNode(state: WorkflowState) {
  if (state.intent !== "ordinary") {
    return { decision: workflowFailureDecision() };
  }
  if (state.retrieval === "failed" || !state.grounded) {
    return { decision: retrievalFailureDecision() };
  }
  return { decision: fromGrounded(state.grounded, "ordinary") };
}

function escalateNode(state: WorkflowState) {
  if (state.intent === "human_request") {
    return {
      decision: escalationDecision(
        "human_request",
        "customer_requested_human",
        humanEscalationMessage,
      ),
    };
  }
  if (state.intent === "possible_order") {
    return {
      decision: escalationDecision(
        "possible_order",
        "business_tool_unavailable",
        orderEscalationMessage,
      ),
    };
  }
  return { decision: workflowFailureDecision() };
}

export function supportWorkflowNodeTimeoutMs(timeoutMs: number): number {
  return timeoutMs + nodeTimeoutBufferMs;
}

export function createSupportWorkflow(timeoutMs: number) {
  const nodeTimeout = supportWorkflowNodeTimeoutMs(timeoutMs);
  const builder = new StateGraph(SupportWorkflowState)
    .addNode("classify", classifyNode)
    .addNode("retrieve", retrieveNode, { timeout: nodeTimeout })
    .addNode("judge", judgeNode, { timeout: nodeTimeout })
    .addNode("answer", answerNode)
    .addNode("clarify", clarifyNode)
    .addNode("abstain", abstainNode)
    .addNode("escalate", escalateNode)
    .addEdge(START, "classify")
    .addConditionalEdges("classify", routeAfterClassify)
    .addConditionalEdges("retrieve", routeAfterRetrieve)
    .addConditionalEdges("judge", routeAfterJudge)
    .addEdge("answer", END)
    .addEdge("clarify", END)
    .addEdge("abstain", END)
    .addEdge("escalate", END);

  const nodeNames = Object.keys(builder.nodes);
  const allowed = new Set<string>(supportWorkflowNodeNames);
  if (
    nodeNames.length !== supportWorkflowNodeNames.length ||
    nodeNames.some((name) => !allowed.has(name))
  ) {
    throw new Error("Undeclared workflow node.");
  }

  return {
    nodeNames,
    graph: builder.compile(),
  };
}
