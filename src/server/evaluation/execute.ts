import "server-only";

import type { ChatProvider } from "@/server/answers/provider";
import { resolveOrderNumber } from "@/server/orders/request";
import type { OrderSummary } from "@/server/orders/types";
import type { RetrievedEvidence } from "@/server/retrieval/retrieve";
import { runSupportWorkflow } from "@/server/workflow/run";

import type { EvaluationCase } from "@/server/evaluation/dataset";
import type { GradeObservation } from "@/server/evaluation/grade";

const inventedChunkId = "00000000-0000-4000-8000-000000000099";
const toteOrderId = "10000000-0000-4000-8000-000000000104";

const tote: OrderSummary = {
  id: toteOrderId,
  orderNumber: "1042",
  status: "shipped",
  placedOn: "2026-11-01",
  summary: "Canvas tote is on the way.",
};

export type PreparedEvidence = {
  loadHits: () => Promise<RetrievedEvidence[]>;
  keyByDocumentId: Map<string, string>;
  callerTenantId: string;
  retrievalMeasured: boolean;
};

export async function executeCase(input: {
  item: EvaluationCase;
  supportName: string;
  asOf: string;
  timeoutMs: number;
  evidence: PreparedEvidence | null;
  chat?: ChatProvider;
}): Promise<{
  observation: GradeObservation;
  latencyMs: number;
  hits: RetrievedEvidence[];
}> {
  const started = performance.now();
  if (!input.evidence) {
    return {
      latencyMs: elapsed(started),
      hits: [],
      observation: emptyObservation(false, false, ""),
    };
  }

  const trace = {
    chatCalls: 0,
    retrieveCalls: 0,
    lookupCalls: 0,
    hits: [] as RetrievedEvidence[],
  };
  const chat = input.chat ?? scriptedChat(input.item, trace);
  const decision = await runSupportWorkflow({
    question: input.item.question,
    context: {
      tenantId: input.evidence.callerTenantId,
      asOf: input.asOf,
      timeoutMs: input.timeoutMs,
      chat,
      retrieve: async () => {
        trace.retrieveCalls += 1;
        trace.hits = await input.evidence!.loadHits();
        return trace.hits;
      },
      orderAccess: orderAccess(input.item, trace),
      supportName: input.supportName,
    },
  });
  const citationDocumentKeys = decision.citations.map(
    (citation) =>
      input.evidence?.keyByDocumentId.get(citation.documentId) ??
      citation.documentId,
  );
  return {
    latencyMs: elapsed(started),
    hits: trace.hits,
    observation: {
      workflowMeasured: true,
      retrievalMeasured: input.evidence.retrievalMeasured,
      outcome: decision.outcome,
      answerReason: decision.answerReason,
      citationValidation: decision.citationValidation,
      retrievalKeys:
        input.evidence.retrievalMeasured && trace.retrieveCalls > 0
          ? keysForHits(trace.hits, input.evidence.keyByDocumentId)
          : null,
      citationDocumentKeys,
      evidenceDocumentKeys: keysForHits(
        trace.hits,
        input.evidence.keyByDocumentId,
      ),
      chatCalls: trace.chatCalls,
      retrieveCalls: trace.retrieveCalls,
      lookupCalls: trace.lookupCalls,
      evidenceTenantIds: trace.hits.map((hit) => hit.tenantId),
      callerTenantId: input.evidence.callerTenantId,
      body: decision.body,
      evidenceText: trace.hits.map((hit) => hit.text).join("\n"),
    },
  };
}

function scriptedChat(
  item: EvaluationCase,
  trace: { chatCalls: number; hits: readonly RetrievedEvidence[] },
): ChatProvider {
  return {
    model: "fixture-model",
    complete: () => {
      trace.chatCalls += 1;
      if (item.model.mode === "throw") {
        throw new Error("provider down");
      }
      return Promise.resolve({
        model: "fixture-model",
        content: scriptedContent(item, trace.hits),
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      });
    },
  };
}

function scriptedContent(
  item: EvaluationCase,
  hits: readonly RetrievedEvidence[],
): string {
  if (item.model.mode === "order_json") {
    return JSON.stringify({
      orderId: item.model.orderId,
      customerId: item.model.customerId,
      orders: item.model.orders,
    });
  }
  if (item.model.mode !== "json") {
    return "{}";
  }
  const citations =
    item.model.citations === "all"
      ? hits.map((hit) => ({ chunkId: hit.chunkId }))
      : item.model.citations === "invented"
        ? [{ chunkId: inventedChunkId }]
        : [];
  const payload: Record<string, unknown> = {
    answer: item.model.answer,
    citations,
    abstained: item.model.abstained,
    conflict: item.model.conflict,
  };
  if (item.model.extraTool) {
    payload.tool = "list_all_tenants";
  }
  return JSON.stringify(payload);
}

function orderAccess(
  item: EvaluationCase,
  trace: { lookupCalls: number },
):
  | { mode: "anonymous" }
  | { mode: "unregistered" }
  | {
      mode: "customer";
      lookup: (
        modelOutput: unknown,
        question: string,
      ) => Promise<
        { status: "found"; order: OrderSummary } | { status: "none" }
      >;
    } {
  if (item.actor === "anonymous") {
    return { mode: "anonymous" };
  }
  if (item.actor !== "customer") {
    return { mode: "unregistered" };
  }
  return {
    mode: "customer",
    lookup: (modelOutput, question) => {
      trace.lookupCalls += 1;
      const orderNumber = resolveOrderNumber(question, modelOutput);
      if (orderNumber !== tote.orderNumber) {
        return Promise.resolve({ status: "none" });
      }
      return Promise.resolve({ status: "found", order: tote });
    },
  };
}

function keysForHits(
  hits: readonly RetrievedEvidence[],
  keyByDocumentId: Map<string, string>,
): string[] {
  return hits.map(
    (hit) => keyByDocumentId.get(hit.documentId) ?? hit.documentId,
  );
}

function emptyObservation(
  workflowMeasured: boolean,
  retrievalMeasured: boolean,
  callerTenantId: string,
): GradeObservation {
  return {
    workflowMeasured,
    retrievalMeasured,
    outcome: null,
    answerReason: null,
    citationValidation: null,
    retrievalKeys: null,
    citationDocumentKeys: [],
    evidenceDocumentKeys: [],
    chatCalls: 0,
    retrieveCalls: 0,
    lookupCalls: 0,
    evidenceTenantIds: [],
    callerTenantId,
    body: null,
    evidenceText: "",
  };
}

function elapsed(started: number): number {
  return Math.max(0, Math.round(performance.now() - started));
}
