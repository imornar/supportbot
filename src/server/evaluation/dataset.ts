import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

import {
  citationValidations,
  answerReasons,
} from "@/server/conversations/schema";
import {
  retrievalDatasetSchema,
  type RetrievalDataset,
} from "@/server/retrieval/dataset";
import { workflowOutcomes } from "@/server/workflow/decision";

export const evaluationCategories = [
  "single_source",
  "multi_source",
  "missing",
  "conflicting",
  "outdated",
  "cross_tenant",
  "question_injection",
  "document_injection",
  "unauthorized_order",
  "human_request",
  "provider_failure",
] as const;

const applicability = z.enum(["graded", "not_applicable"]);

const bodyTokens = [
  "insufficient_evidence",
  "unavailable",
  "sign_in",
  "order_unavailable",
  "order_refusal",
  "human",
] as const;

const modelSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("none") }).strict(),
  z.object({ mode: z.literal("throw") }).strict(),
  z
    .object({
      mode: z.literal("json"),
      answer: z.string().max(4_000),
      citations: z.enum(["all", "invented", "none"]),
      abstained: z.boolean(),
      conflict: z.boolean(),
      extraTool: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      mode: z.literal("order_json"),
      orderId: z.string().nullable(),
      customerId: z.string().min(1).max(80),
      orders: z.array(z.string().min(1).max(40)).max(10),
    })
    .strict(),
]);

const caseSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    category: z.enum(evaluationCategories),
    question: z.string().trim().min(1).max(2_000),
    note: z.string().trim().min(1).max(500),
    actor: z.enum(["anonymous", "unregistered", "customer"]),
    retrievalQueryId: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .optional(),
    expectedDocumentKeys: z
      .array(z.string().regex(/^[a-z0-9-]+$/))
      .max(20)
      .optional(),
    isolateTenants: z.boolean().optional(),
    liveProbe: z.boolean().optional(),
    forbiddenText: z.array(z.string().min(1).max(200)).max(5).optional(),
    model: modelSchema,
    expect: z
      .object({
        outcome: z.enum(workflowOutcomes),
        answerReason: z.enum(answerReasons),
        citationValidation: z.enum(citationValidations),
        citationKeys: z.enum(["retrieved", "none"]),
        chatCalled: z.boolean(),
        retrieveCalled: z.boolean(),
        lookupCalled: z.boolean(),
        body: z.enum(bodyTokens).optional(),
        bodyExcludes: z.array(z.string().min(1).max(200)).max(10).optional(),
      })
      .strict(),
    grades: z
      .object({
        retrieval: applicability,
        citation: applicability,
        abstention: applicability,
        escalation: applicability,
        auth: applicability,
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    const hasRetrieval = value.retrievalQueryId !== undefined;
    if (value.grades.retrieval === "graded" && !hasRetrieval) {
      context.addIssue({
        code: "custom",
        path: ["retrievalQueryId"],
        message: "retrieval_query_required",
      });
    }
    if (hasRetrieval && !value.expectedDocumentKeys) {
      context.addIssue({
        code: "custom",
        path: ["expectedDocumentKeys"],
        message: "expected_keys_required",
      });
    }
    if (value.isolateTenants && !value.forbiddenText?.length) {
      context.addIssue({
        code: "custom",
        path: ["forbiddenText"],
        message: "forbidden_text_required",
      });
    }
    if (value.liveProbe && !hasRetrieval) {
      context.addIssue({
        code: "custom",
        path: ["liveProbe"],
        message: "live_probe_needs_evidence",
      });
    }
    if (value.actor === "customer" && value.model.mode !== "order_json") {
      context.addIssue({
        code: "custom",
        path: ["model"],
        message: "customer_actor_needs_order_json",
      });
    }
    if (value.actor === "customer" && !value.expect.lookupCalled) {
      context.addIssue({
        code: "custom",
        path: ["expect", "lookupCalled"],
        message: "customer_actor_calls_lookup",
      });
    }
    if (value.actor !== "customer" && value.expect.lookupCalled) {
      context.addIssue({
        code: "custom",
        path: ["expect", "lookupCalled"],
        message: "lookup_requires_customer_actor",
      });
    }
  });

export const evaluationDatasetSchema = z
  .object({
    version: z.literal(1),
    supportName: z.string().trim().min(1).max(80),
    cases: z.array(caseSchema).min(1).max(40),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = value.cases.map((item) => item.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        path: ["cases"],
        message: "duplicate_case_id",
      });
    }
    const seen = new Set(value.cases.map((item) => item.category));
    for (const category of evaluationCategories) {
      if (!seen.has(category)) {
        context.addIssue({
          code: "custom",
          path: ["cases"],
          message: `missing_${category}`,
        });
      }
    }
  });

export type EvaluationDataset = z.infer<typeof evaluationDatasetSchema>;
export type EvaluationCase = EvaluationDataset["cases"][number];
export type EvaluationBodyToken = (typeof bodyTokens)[number];

export function loadEvaluationInputs(root = process.cwd()): {
  evaluation: EvaluationDataset;
  retrieval: RetrievalDataset;
} {
  const evaluation = evaluationDatasetSchema.parse(
    readJson(path.join(root, "fixtures/evaluation/dataset.json")),
  );
  const retrieval = retrievalDatasetSchema.parse(
    readJson(path.join(root, "fixtures/retrieval/dataset.json")),
  );
  for (const item of evaluation.cases) {
    if (!item.retrievalQueryId) {
      continue;
    }
    const query = retrieval.queries.find(
      (candidate) => candidate.id === item.retrievalQueryId,
    );
    if (!query) {
      throw new Error(
        `Evaluation case ${item.id} names an unknown retrieval query.`,
      );
    }
  }
  return { evaluation, retrieval };
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8")) as unknown;
}
