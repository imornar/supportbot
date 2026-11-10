import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { chatCredentialsConfigured } from "@/server/answers/provider";
import { closePool } from "@/server/db/client";
import { tenantBPolicyText } from "@/server/evaluation/corpus";
import { estimateLiveChatUsd } from "@/server/evaluation/cost";
import { loadEvaluationInputs } from "@/server/evaluation/dataset";
import { gradeCase, type GradeObservation } from "@/server/evaluation/grade";
import {
  evaluationPassed,
  formatEvaluationReport,
} from "@/server/evaluation/report";
import { runEvaluation } from "@/server/evaluation/run";

const databaseUrl = process.env.DATABASE_URL?.trim();

describe("evaluation dataset", () => {
  it("covers every required category and contains no credentials", () => {
    const raw = readFileSync(
      path.join(process.cwd(), "fixtures/evaluation/dataset.json"),
      "utf8",
    );
    expect(raw).not.toMatch(/sk-/);
    expect(raw).not.toMatch(/postgres(?:ql)?:\/\//);
    expect(raw).not.toMatch(/@[a-z0-9.-]+\.(?:com|net|org)/);
    const { evaluation } = loadEvaluationInputs();
    const crossTenant = evaluation.cases.find(
      (item) => item.id === "cross-tenant",
    );
    expect(crossTenant?.forbiddenText).toEqual([tenantBPolicyText]);
    expect(evaluation.cases.some((item) => item.liveProbe)).toBe(true);
  });
});

describe("evaluation graders", () => {
  it("fails a retrieval mismatch and does not treat it as a pass", () => {
    const { evaluation } = loadEvaluationInputs();
    const item = evaluation.cases.find(
      (candidate) => candidate.id === "single-source",
    );
    expect(item).toBeDefined();
    if (!item) {
      return;
    }
    const graded = gradeCase(
      item,
      observation({
        retrievalMeasured: true,
        retrievalKeys: ["returns"],
        citationDocumentKeys: ["returns"],
        evidenceDocumentKeys: ["returns"],
      }),
      evaluation.supportName,
    );
    expect(graded.metrics.retrieval).toBe("fail");
    expect(graded.metrics.answerText).toBe("not_measured");
    expect(graded.result).toBe("fail");
  });

  it("leaves retrieval unmeasured when the database was not used", () => {
    const { evaluation } = loadEvaluationInputs();
    const item = evaluation.cases.find(
      (candidate) => candidate.id === "single-source",
    );
    expect(item).toBeDefined();
    if (!item) {
      return;
    }
    const graded = gradeCase(
      item,
      observation({ retrievalMeasured: false, retrievalKeys: null }),
      evaluation.supportName,
    );
    expect(graded.metrics.retrieval).toBe("not_measured");
    expect(graded.metrics.citation).toBe("pass");
    expect(graded.result).toBe("incomplete");
  });

  it("estimates live chat cost from list rates and leaves a blank key unconfigured", () => {
    expect(
      estimateLiveChatUsd({ inputTokens: 1_000_000, outputTokens: 1_000_000 }),
    ).toBe(2);
    expect(chatCredentialsConfigured({ OPENAI_API_KEY: "" })).toBe(false);
    expect(chatCredentialsConfigured({ OPENAI_API_KEY: "replace-me" })).toBe(
      false,
    );
    expect(chatCredentialsConfigured({ OPENAI_API_KEY: "test-key" })).toBe(
      true,
    );
  });
});

describe("fixture evaluation", () => {
  it("passes workflow checks without calling a model and without a database", async () => {
    const report = await runEvaluation({
      useDatabase: false,
      live: false,
      env: { OPENAI_API_KEY: "" },
    });
    expect(report.database).toBe("not_measured");
    expect(report.live).toBe("not_measured");
    expect(report.estimatedCostUsd).toBeNull();
    expect(
      report.cases.find((item) => item.id === "human-request"),
    ).toMatchObject({
      result: "pass",
      metrics: { escalation: "pass", answerText: "not_measured" },
    });
    expect(
      report.cases.find((item) => item.id === "single-source"),
    ).toMatchObject({
      result: "incomplete",
      metrics: { retrieval: "not_measured", citation: "pass" },
    });
    expect(
      report.cases.find((item) => item.id === "cross-tenant"),
    ).toMatchObject({
      result: "incomplete",
      metrics: { retrieval: "not_measured", auth: "not_measured" },
    });
    expect(
      report.cases.find((item) => item.id === "question-injection"),
    ).toMatchObject({
      metrics: { citation: "pass", auth: "pass", abstention: "pass" },
    });
    expect(
      report.cases.find((item) => item.id === "unauthorized-all-orders")
        ?.result,
    ).toBe("pass");
    expect(report.cases.some((item) => item.result === "fail")).toBe(false);
    const printed = formatEvaluationReport(report);
    expect(printed).toContain("Estimated cost: not measured");
    expect(printed).toContain("Answer text");
    expect(printed).not.toContain("USD");
    expect(evaluationPassed(report, { strict: false, live: false })).toBe(true);
    expect(evaluationPassed(report, { strict: true, live: false })).toBe(false);
  });
});

describe.skipIf(!databaseUrl)("evaluation database", () => {
  afterAll(async () => {
    await closePool();
  });

  it("passes strict fixture checks, including tenant isolation", async () => {
    const report = await runEvaluation({
      useDatabase: true,
      live: false,
      env: { ...process.env, OPENAI_API_KEY: "" },
    });
    const failed = report.cases.filter((item) => item.result !== "pass");
    expect(failed).toEqual([]);
    expect(report.database).toBe("measured");
    expect(report.estimatedCostUsd).toBeNull();
    expect(evaluationPassed(report, { strict: true, live: false })).toBe(true);
    const isolation = report.cases.find((item) => item.id === "cross-tenant");
    expect(isolation?.metrics.retrieval).toBe("pass");
    expect(isolation?.metrics.auth).toBe("pass");
  });
});

function observation(overrides: Partial<GradeObservation>): GradeObservation {
  return {
    workflowMeasured: true,
    retrievalMeasured: true,
    outcome: "answered",
    answerReason: "grounded",
    citationValidation: "passed",
    retrievalKeys: ["shipping"],
    citationDocumentKeys: ["shipping"],
    evidenceDocumentKeys: ["shipping"],
    chatCalls: 1,
    retrieveCalls: 1,
    lookupCalls: 0,
    evidenceTenantIds: ["11111111-1111-4111-8111-111111111111"],
    callerTenantId: "11111111-1111-4111-8111-111111111111",
    body: "Standard shipping takes 3 to 5 business days inside the country.",
    evidenceText:
      "Standard shipping takes 3 to 5 business days inside the country.",
    ...overrides,
  };
}
