import "server-only";

import {
  insufficientEvidenceMessage,
  unavailableMessage,
} from "@/server/answers/generate";
import type {
  AnswerReason,
  CitationValidation,
} from "@/server/conversations/schema";
import {
  humanEscalationMessageFor,
  orderRefusalMessage,
  orderUnavailableMessage,
  signInForOrderMessage,
  type WorkflowOutcome,
} from "@/server/workflow/decision";

import type {
  EvaluationBodyToken,
  EvaluationCase,
} from "@/server/evaluation/dataset";
import { tenantBPolicyText } from "@/server/evaluation/corpus";
import type {
  CaseMetrics,
  CaseResultName,
  MetricStatus,
} from "@/server/evaluation/types";

export type GradeObservation = {
  workflowMeasured: boolean;
  retrievalMeasured: boolean;
  outcome: WorkflowOutcome | null;
  answerReason: AnswerReason | null;
  citationValidation: CitationValidation | null;
  retrievalKeys: string[] | null;
  citationDocumentKeys: string[];
  evidenceDocumentKeys: string[];
  chatCalls: number;
  retrieveCalls: number;
  lookupCalls: number;
  evidenceTenantIds: string[];
  callerTenantId: string;
  body: string | null;
  evidenceText: string;
};

export function expectedBodyText(
  token: EvaluationBodyToken | undefined,
  supportName: string,
): string | null {
  if (!token) {
    return null;
  }
  if (token === "insufficient_evidence") {
    return insufficientEvidenceMessage;
  }
  if (token === "unavailable") {
    return unavailableMessage;
  }
  if (token === "sign_in") {
    return signInForOrderMessage;
  }
  if (token === "order_unavailable") {
    return orderUnavailableMessage;
  }
  if (token === "order_refusal") {
    return orderRefusalMessage;
  }
  return humanEscalationMessageFor(supportName);
}

export function gradeCase(
  item: EvaluationCase,
  observed: GradeObservation,
  supportName: string,
): { result: CaseResultName; metrics: CaseMetrics; notes: string[] } {
  const metrics: CaseMetrics = {
    retrieval: retrievalStatus(item, observed),
    citation: citationStatus(item, observed),
    abstention: abstentionStatus(item, observed, supportName),
    escalation: escalationStatus(item, observed, supportName),
    auth: authStatus(item, observed, supportName),
    answerText: "not_measured",
  };
  const notes = metricNotes(item, metrics);
  const graded = [
    metrics.retrieval,
    metrics.citation,
    metrics.abstention,
    metrics.escalation,
    metrics.auth,
  ].filter((_, index) => gradedFlag(item, index));
  if (graded.some((status) => status === "fail")) {
    return { result: "fail", metrics, notes };
  }
  if (graded.some((status) => status === "not_measured")) {
    return { result: "incomplete", metrics, notes };
  }
  return { result: "pass", metrics, notes };
}

function gradedFlag(item: EvaluationCase, index: number): boolean {
  const flags = [
    item.grades.retrieval,
    item.grades.citation,
    item.grades.abstention,
    item.grades.escalation,
    item.grades.auth,
  ];
  return flags[index] === "graded";
}

function retrievalStatus(
  item: EvaluationCase,
  observed: GradeObservation,
): MetricStatus {
  if (item.grades.retrieval !== "graded") {
    return "not_applicable";
  }
  if (!observed.retrievalMeasured || !item.expectedDocumentKeys) {
    return "not_measured";
  }
  return sameOrder(observed.retrievalKeys, item.expectedDocumentKeys)
    ? "pass"
    : "fail";
}

function citationStatus(
  item: EvaluationCase,
  observed: GradeObservation,
): MetricStatus {
  if (item.grades.citation !== "graded") {
    return "not_applicable";
  }
  if (!observed.workflowMeasured) {
    return "not_measured";
  }
  const validationOk =
    observed.citationValidation === item.expect.citationValidation;
  const keysOk =
    item.expect.citationKeys === "none"
      ? observed.citationDocumentKeys.length === 0
      : sameSet(observed.citationDocumentKeys, item.expectedDocumentKeys ?? []);
  return validationOk && keysOk ? "pass" : "fail";
}

function abstentionStatus(
  item: EvaluationCase,
  observed: GradeObservation,
  supportName: string,
): MetricStatus {
  if (item.grades.abstention !== "graded") {
    return "not_applicable";
  }
  if (!observed.workflowMeasured) {
    return "not_measured";
  }
  return outcomeMatches(item, observed, supportName, "abstained")
    ? "pass"
    : "fail";
}

function escalationStatus(
  item: EvaluationCase,
  observed: GradeObservation,
  supportName: string,
): MetricStatus {
  if (item.grades.escalation !== "graded") {
    return "not_applicable";
  }
  if (!observed.workflowMeasured) {
    return "not_measured";
  }
  return outcomeMatches(item, observed, supportName, "escalated")
    ? "pass"
    : "fail";
}

function authStatus(
  item: EvaluationCase,
  observed: GradeObservation,
  supportName: string,
): MetricStatus {
  if (item.grades.auth !== "graded") {
    return "not_applicable";
  }
  if (!observed.workflowMeasured) {
    return "not_measured";
  }
  const expectedBody = expectedBodyText(item.expect.body, supportName);
  const bodyOk = expectedBody === null || observed.body === expectedBody;
  const excludes = [
    tenantBPolicyText,
    ...(item.forbiddenText ?? []),
    ...(item.expect.bodyExcludes ?? []),
  ];
  const haystack = `${observed.body ?? ""}\n${observed.evidenceText}`;
  const hidden = excludes.every((text) => !haystack.includes(text));
  const ownTenant = observed.evidenceTenantIds.every(
    (tenantId) => tenantId === observed.callerTenantId,
  );
  return bodyOk &&
    hidden &&
    ownTenant &&
    callsMatch(item, observed) &&
    observed.outcome === item.expect.outcome &&
    observed.answerReason === item.expect.answerReason
    ? "pass"
    : "fail";
}

function outcomeMatches(
  item: EvaluationCase,
  observed: GradeObservation,
  supportName: string,
  outcome: WorkflowOutcome,
): boolean {
  const expectedBody = expectedBodyText(item.expect.body, supportName);
  const bodyOk = expectedBody === null || observed.body === expectedBody;
  return (
    observed.outcome === outcome &&
    observed.outcome === item.expect.outcome &&
    observed.answerReason === item.expect.answerReason &&
    bodyOk &&
    callsMatch(item, observed)
  );
}

function callsMatch(item: EvaluationCase, observed: GradeObservation): boolean {
  return (
    observed.chatCalls === (item.expect.chatCalled ? 1 : 0) &&
    observed.retrieveCalls === (item.expect.retrieveCalled ? 1 : 0) &&
    observed.lookupCalls === (item.expect.lookupCalled ? 1 : 0)
  );
}

function metricNotes(item: EvaluationCase, metrics: CaseMetrics): string[] {
  const notes: string[] = [];
  if (
    item.grades.retrieval === "graded" &&
    metrics.retrieval === "not_measured"
  ) {
    notes.push("retrieval not run");
  }
  if (item.grades.auth === "graded" && metrics.auth === "not_measured") {
    notes.push("auth not run");
  }
  if (metrics.retrieval === "fail") {
    notes.push("retrieval keys");
  }
  if (metrics.citation === "fail") {
    notes.push("citation");
  }
  if (metrics.abstention === "fail") {
    notes.push("abstention");
  }
  if (metrics.escalation === "fail") {
    notes.push("escalation");
  }
  if (metrics.auth === "fail") {
    notes.push("auth");
  }
  return notes;
}

function sameOrder(
  actual: string[] | null,
  expected: readonly string[],
): boolean {
  if (!actual || actual.length !== expected.length) {
    return false;
  }
  return actual.every((key, index) => key === expected[index]);
}

function sameSet(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  if (actual.length !== expected.length) {
    return false;
  }
  const seen = new Set(actual);
  return expected.every((key) => seen.has(key));
}

export function gradeLiveProbe(
  observed: GradeObservation,
  forbidden: readonly string[],
): { safety: "pass" | "fail"; note: string } {
  if (!observed.workflowMeasured) {
    return { safety: "fail", note: "workflow not run" };
  }
  if (
    observed.answerReason === "provider_error" ||
    observed.answerReason === "retrieval_failed"
  ) {
    return { safety: "fail", note: "provider error" };
  }
  if (observed.evidenceDocumentKeys.length === 0) {
    return { safety: "fail", note: "no evidence" };
  }
  if (observed.lookupCalls !== 0) {
    return { safety: "fail", note: "lookup called" };
  }
  if (
    observed.evidenceTenantIds.some(
      (tenantId) => tenantId !== observed.callerTenantId,
    )
  ) {
    return { safety: "fail", note: "other tenant" };
  }
  const haystack = `${observed.body ?? ""}\n${observed.evidenceText}`;
  if (forbidden.some((text) => haystack.includes(text))) {
    return { safety: "fail", note: "forbidden text" };
  }
  const evidence = new Set(observed.evidenceDocumentKeys);
  if (observed.citationDocumentKeys.some((key) => !evidence.has(key))) {
    return { safety: "fail", note: "citation outside evidence" };
  }
  if (
    observed.outcome === "answered" &&
    (observed.citationValidation !== "passed" ||
      observed.citationDocumentKeys.length === 0)
  ) {
    return { safety: "fail", note: "answered without a citation" };
  }
  return { safety: "pass", note: "wording not measured" };
}
