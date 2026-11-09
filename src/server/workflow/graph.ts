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
  buildOrderExtractionMessages,
  parseModelJson,
} from "@/server/orders/request";
import type { OrderAccess } from "@/server/orders/types";
import {
  clarificationDecision,
  escalationDecision,
  fromGrounded,
  humanEscalationMessageFor,
  isPublicSupportName,
  orderFoundDecision,
  orderRefusalDecision,
  orderUnavailableDecision,
  retrievalFailureDecision,
  signInForOrderDecision,
  workflowFailureDecision,
  type PersistedAnswer,
} from "@/server/workflow/decision";
import {
  classifySupportQuestion,
  type WorkflowIntent,
} from "@/server/workflow/intent";
import { withTimeout } from "@/server/workflow/timeout";

/**
 * Closed list. `lookup_order` is the one business read. The model does not
 * choose a tool name, and a caller-supplied tool map is not read.
 */
export const supportWorkflowNodeNames = [
  "classify",
  "retrieve",
  "judge",
  "answer",
  "clarify",
  "abstain",
  "escalate",
  "lookup_order",
] as const;

export type SupportWorkflowNodeName = (typeof supportWorkflowNodeNames)[number];

const nodeTimeoutBufferMs = 1_000;

export type SupportWorkflowContext = {
  tenantId: string;
  asOf: string;
  timeoutMs: number;
  chat: ChatProvider;
  retrieve: (question: string) => Promise<RetrievedEvidence[]>;
  orderAccess: OrderAccess;
  supportName: string;
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
): "escalate" | "clarify" | "retrieve" | "lookup_order" {
  if (state.intent === "human_request") {
    return "escalate";
  }
  if (state.intent === "possible_order") {
    return "lookup_order";
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
    typeof candidate.chat?.complete === "function" &&
    isOrderAccess(candidate.orderAccess) &&
    isPublicSupportName(candidate.supportName)
  );
}

function isOrderAccess(value: unknown): value is OrderAccess {
  if (!value || typeof value !== "object") {
    return false;
  }
  const mode = (value as { mode?: unknown }).mode;
  if (mode === "anonymous" || mode === "unregistered") {
    return true;
  }
  return (
    mode === "customer" &&
    typeof (value as { lookup?: unknown }).lookup === "function"
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

function abstainNode(state: WorkflowState, config: NodeConfig) {
  if (state.intent !== "ordinary") {
    return {
      decision: workflowFailureDecision(
        state.intent ?? "ordinary",
        readContext(config).supportName,
      ),
    };
  }
  if (state.retrieval === "failed" || !state.grounded) {
    return { decision: retrievalFailureDecision() };
  }
  return { decision: fromGrounded(state.grounded, "ordinary") };
}

function escalateNode(state: WorkflowState, config: NodeConfig) {
  const supportName = readContext(config).supportName;
  if (state.intent === "human_request") {
    return {
      decision: escalationDecision(
        "human_request",
        "customer_requested_human",
        humanEscalationMessageFor(supportName),
      ),
    };
  }
  return {
    decision: workflowFailureDecision(state.intent ?? "ordinary", supportName),
  };
}

async function lookupOrderNode(state: WorkflowState, config: NodeConfig) {
  const context = readContext(config);
  if (context.orderAccess.mode === "anonymous") {
    return { decision: signInForOrderDecision() };
  }
  if (context.orderAccess.mode !== "customer") {
    return { decision: orderUnavailableDecision() };
  }
  let modelOutput: unknown = null;
  try {
    const completion = await withTimeout(
      context.chat.complete({
        messages: buildOrderExtractionMessages(state.question),
      }),
      context.timeoutMs,
      config.signal,
    );
    modelOutput = parseModelJson(completion.content);
  } catch {
    modelOutput = null;
  }
  try {
    const result = await withTimeout(
      context.orderAccess.lookup(modelOutput, state.question),
      context.timeoutMs,
      config.signal,
    );
    if (result.status === "found") {
      return { decision: orderFoundDecision(result.order) };
    }
    return { decision: orderRefusalDecision() };
  } catch {
    return {
      decision: workflowFailureDecision(
        "possible_order",
        readContext(config).supportName,
      ),
    };
  }
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
    .addNode("lookup_order", lookupOrderNode, { timeout: nodeTimeout })
    .addEdge(START, "classify")
    .addConditionalEdges("classify", routeAfterClassify)
    .addConditionalEdges("retrieve", routeAfterRetrieve)
    .addConditionalEdges("judge", routeAfterJudge)
    .addEdge("answer", END)
    .addEdge("clarify", END)
    .addEdge("abstain", END)
    .addEdge("escalate", END)
    .addEdge("lookup_order", END);

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
