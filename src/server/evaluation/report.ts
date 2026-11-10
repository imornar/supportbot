import "server-only";

import { chatModel } from "@/server/answers/provider";

import { liveChatListRates } from "@/server/evaluation/cost";
import type { EvaluationReport } from "@/server/evaluation/types";

export function evaluationPassed(
  report: EvaluationReport,
  options: { strict: boolean; live: boolean },
): boolean {
  if (report.cases.some((item) => item.result === "fail")) {
    return false;
  }
  if (
    options.strict &&
    report.cases.some((item) => item.result === "incomplete")
  ) {
    return false;
  }
  if (!options.live) {
    return true;
  }
  return (
    report.live === "measured" &&
    report.liveProbes.length > 0 &&
    report.liveProbes.every((probe) => probe.safety === "pass")
  );
}

export function formatEvaluationReport(report: EvaluationReport): string {
  const counts = countResults(report);
  const lines = [
    "# Evaluation report",
    "",
    "Fixture mode uses scripted model output and fixture embeddings. Answer wording is not measured. A passing citation or auth cell is a deterministic check. A not measured cell was not scored.",
    "",
    `Database retrieval: ${label(report.database)}`,
    `Estimated cost: ${formatCost(report.estimatedCostUsd)}`,
    `Cases: ${counts.pass} pass, ${counts.incomplete} incomplete, ${counts.fail} fail`,
    "",
    "| Case | Result | Retrieval | Citation | Abstention | Escalation | Auth | Answer text | Latency ms | Notes |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...report.cases.map((item) => {
      const metrics = item.metrics;
      return `| ${item.id} | ${item.result} | ${cell(metrics.retrieval)} | ${cell(metrics.citation)} | ${cell(metrics.abstention)} | ${cell(metrics.escalation)} | ${cell(metrics.auth)} | ${cell(metrics.answerText)} | ${item.latencyMs} | ${item.notes.join(", ")} |`;
    }),
    "",
    "## Live model",
    "",
    liveSection(report),
    "",
  ];
  return lines.join("\n");
}

function liveSection(report: EvaluationReport): string {
  if (report.live !== "measured") {
    return [
      "not measured",
      "",
      "Pass `--live` with `OPENAI_API_KEY` set to call the configured chat model. That run still uses fixture embeddings. It checks that citations stay inside the retrieved rows and that the question cannot call order lookup. It does not score wording, and CI does not pass `--live`.",
    ].join("\n");
  }
  const header = [
    `${chatModel} was called. Safety is citation membership, tenant of the evidence, and whether order lookup ran. Answer wording is not measured.`,
    `List rates used for the estimate: $${liveChatListRates.inputUsdPerMillionTokens.toFixed(2)} per million input tokens and $${liveChatListRates.outputUsdPerMillionTokens.toFixed(2)} per million output tokens. This is not an invoice.`,
    "",
    "| Case | Safety | Observed outcome | Citation check | Latency ms | Note |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  const rows = report.liveProbes.map(
    (probe) =>
      `| ${probe.id} | ${probe.safety} | ${probe.observedOutcome} | ${probe.citationValidation} | ${probe.latencyMs} | ${probe.note} |`,
  );
  return [...header, ...rows].join("\n");
}

function formatCost(usd: number | null): string {
  if (usd === null) {
    return "not measured";
  }
  return `${usd.toFixed(6)} USD`;
}

function cell(
  status: "pass" | "fail" | "not_measured" | "not_applicable",
): string {
  if (status === "pass" || status === "fail") {
    return status;
  }
  return "not measured";
}

function label(status: "measured" | "not_measured"): string {
  return status === "measured" ? "measured" : "not measured";
}

function countResults(report: EvaluationReport): {
  pass: number;
  fail: number;
  incomplete: number;
} {
  return {
    pass: report.cases.filter((item) => item.result === "pass").length,
    fail: report.cases.filter((item) => item.result === "fail").length,
    incomplete: report.cases.filter((item) => item.result === "incomplete")
      .length,
  };
}
