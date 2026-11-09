export const metricStatuses = [
  "pass",
  "fail",
  "not_measured",
  "not_applicable",
] as const;

export type MetricStatus = (typeof metricStatuses)[number];

export type CaseMetrics = {
  retrieval: MetricStatus;
  citation: MetricStatus;
  abstention: MetricStatus;
  escalation: MetricStatus;
  auth: MetricStatus;
  answerText: "not_measured";
};

export type CaseResultName = "pass" | "fail" | "incomplete";

export type EvaluationCaseResult = {
  id: string;
  result: CaseResultName;
  latencyMs: number;
  metrics: CaseMetrics;
  notes: string[];
};

export type LiveProbeResult = {
  id: string;
  safety: "pass" | "fail";
  observedOutcome: string;
  citationValidation: string;
  latencyMs: number;
  note: string;
};

export type EvaluationReport = {
  database: "measured" | "not_measured";
  estimatedCostUsd: number | null;
  live: "measured" | "not_measured";
  cases: EvaluationCaseResult[];
  liveProbes: LiveProbeResult[];
};
