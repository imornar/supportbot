import "server-only";

import { randomUUID } from "node:crypto";

import {
  chatCredentialsConfigured,
  createChatProvider,
  parseChatTimeoutMs,
  type ChatProvider,
} from "@/server/answers/provider";
import { getDb } from "@/server/db/client";
import type { TenantQueryClient } from "@/server/db/tenant-queries";
import type { RetrievedEvidence } from "@/server/retrieval/retrieve";
import { retrieveEvidence } from "@/server/retrieval/retrieve";
import { fixtureEmbedding } from "@/server/retrieval/fixture-embedding";
import type { RetrievalDataset } from "@/server/retrieval/dataset";
import { isPublicSupportName } from "@/server/workflow/decision";

import {
  seedEvaluationCorpus,
  seedOtherTenantPolicy,
  tenantBPolicyText,
  type CorpusIds,
} from "@/server/evaluation/corpus";
import { estimateLiveChatUsd } from "@/server/evaluation/cost";
import {
  loadEvaluationInputs,
  type EvaluationCase,
  type EvaluationDataset,
} from "@/server/evaluation/dataset";
import {
  executeCase,
  type PreparedEvidence,
} from "@/server/evaluation/execute";
import { gradeCase, gradeLiveProbe } from "@/server/evaluation/grade";
import type {
  EvaluationCaseResult,
  EvaluationReport,
  LiveProbeResult,
} from "@/server/evaluation/types";

const fixtureTimeoutMs = 1_000;
const syntheticTenantId = "11111111-1111-4111-8111-111111111111";

type SavedProbe = {
  item: EvaluationCase;
  hits: RetrievedEvidence[];
  keyByDocumentId: Map<string, string>;
  callerTenantId: string;
  asOf: string;
};

export async function runEvaluation(options: {
  useDatabase: boolean;
  live: boolean;
  env: Record<string, string | undefined>;
}): Promise<EvaluationReport> {
  const { evaluation, retrieval } = loadEvaluationInputs();
  if (!isPublicSupportName(evaluation.supportName)) {
    throw new Error("Evaluation support name is not displayable.");
  }
  const measureDatabase =
    options.useDatabase && Boolean(process.env.DATABASE_URL?.trim());
  const cases: EvaluationCaseResult[] = [];
  const probes: SavedProbe[] = [];

  if (measureDatabase) {
    await withRollback(async (tx) => {
      const tenantId = randomUUID();
      const otherTenantId = randomUUID();
      const userId = randomUUID();
      const ids = await seedEvaluationCorpus(tx, retrieval, tenantId, userId);
      const shipping = retrieval.documents.find(
        (document) => document.key === "shipping",
      );
      if (!shipping) {
        throw new Error("Retrieval dataset is missing shipping.");
      }
      await seedOtherTenantPolicy(tx, {
        tenantId: otherTenantId,
        userId,
        shippingBasis: shipping.basis,
        text: tenantBPolicyText,
      });
      const keyByDocumentId = documentKeyMap(ids);
      for (const item of evaluation.cases) {
        await runOne({
          tx,
          item,
          evaluation,
          retrieval,
          tenantId,
          keyByDocumentId,
          retrievalMeasured: true,
          cases,
          probes,
        });
      }
    });
  } else {
    const ids = syntheticIds(retrieval);
    const keyByDocumentId = documentKeyMap(ids);
    for (const item of evaluation.cases) {
      await runOne({
        tx: null,
        item,
        evaluation,
        retrieval,
        tenantId: syntheticTenantId,
        keyByDocumentId,
        retrievalMeasured: false,
        cases,
        probes,
        syntheticIds: ids,
      });
    }
  }

  const live = await runLiveProbes(probes, evaluation.supportName, options);
  return {
    database: measureDatabase ? "measured" : "not_measured",
    estimatedCostUsd: live.estimatedCostUsd,
    live: live.live,
    cases,
    liveProbes: live.probes,
  };
}

async function runOne(input: {
  tx: TenantQueryClient | null;
  item: EvaluationCase;
  evaluation: EvaluationDataset;
  retrieval: RetrievalDataset;
  tenantId: string;
  keyByDocumentId: Map<string, string>;
  retrievalMeasured: boolean;
  cases: EvaluationCaseResult[];
  probes: SavedProbe[];
  syntheticIds?: CorpusIds;
}): Promise<void> {
  const evidence = prepareEvidence(input);
  const executed = await executeCase({
    item: input.item,
    supportName: input.evaluation.supportName,
    asOf: input.retrieval.asOf,
    timeoutMs: fixtureTimeoutMs,
    evidence,
  });
  const graded = gradeCase(
    input.item,
    executed.observation,
    input.evaluation.supportName,
  );
  input.cases.push({
    id: input.item.id,
    result: graded.result,
    latencyMs: executed.latencyMs,
    metrics: graded.metrics,
    notes: graded.notes,
  });
  if (input.item.liveProbe && evidence) {
    input.probes.push({
      item: input.item,
      hits: executed.hits.map((hit) => ({ ...hit })),
      keyByDocumentId: input.keyByDocumentId,
      callerTenantId: input.tenantId,
      asOf: input.retrieval.asOf,
    });
  }
}

function prepareEvidence(input: {
  tx: TenantQueryClient | null;
  item: EvaluationCase;
  retrieval: RetrievalDataset;
  tenantId: string;
  keyByDocumentId: Map<string, string>;
  retrievalMeasured: boolean;
  syntheticIds?: CorpusIds;
}): PreparedEvidence | null {
  if (input.item.isolateTenants && !input.retrievalMeasured) {
    return null;
  }
  if (!input.item.retrievalQueryId || !input.item.expectedDocumentKeys) {
    if (!input.item.retrievalQueryId) {
      return {
        loadHits: () => Promise.resolve([]),
        keyByDocumentId: input.keyByDocumentId,
        callerTenantId: input.tenantId,
        retrievalMeasured: false,
      };
    }
    return null;
  }
  const query = input.retrieval.queries.find(
    (candidate) => candidate.id === input.item.retrievalQueryId,
  );
  if (!query) {
    throw new Error(`Unknown retrieval query ${input.item.retrievalQueryId}.`);
  }
  if (input.tx) {
    const tx = input.tx;
    return {
      loadHits: () =>
        retrieveEvidence(tx, {
          tenantId: input.tenantId,
          embedding: fixtureEmbedding(query.components),
          settings: {
            topK: query.topK ?? input.retrieval.topK,
            similarityThreshold: input.retrieval.similarityThreshold,
          },
          asOf: input.retrieval.asOf,
        }),
      keyByDocumentId: input.keyByDocumentId,
      callerTenantId: input.tenantId,
      retrievalMeasured: true,
    };
  }
  const ids = input.syntheticIds;
  if (!ids) {
    throw new Error("Synthetic evidence is missing ids.");
  }
  const hits = input.item.expectedDocumentKeys.map((key) => {
    const document = input.retrieval.documents.find((item) => item.key === key);
    const row = ids.get(key);
    if (!document || !row) {
      throw new Error(`Evaluation fixture is missing ${key}.`);
    }
    return {
      chunkId: row.chunkId,
      documentId: row.documentId,
      tenantId: input.tenantId,
      title: document.title,
      section: document.section,
      text: document.text,
      score: 1,
      documentVersion: 1,
      effectiveDate: document.effectiveDate,
    } satisfies RetrievedEvidence;
  });
  return {
    loadHits: () => Promise.resolve(hits),
    keyByDocumentId: input.keyByDocumentId,
    callerTenantId: input.tenantId,
    retrievalMeasured: false,
  };
}

async function runLiveProbes(
  probes: readonly SavedProbe[],
  supportName: string,
  options: { live: boolean; env: Record<string, string | undefined> },
): Promise<{
  live: "measured" | "not_measured";
  estimatedCostUsd: number | null;
  probes: LiveProbeResult[];
}> {
  if (!options.live || !chatCredentialsConfigured(options.env)) {
    return { live: "not_measured", estimatedCostUsd: null, probes: [] };
  }
  const usage = { inputTokens: 0, outputTokens: 0 };
  const chat = meter(createChatProvider(options.env), usage);
  const timeoutMs = parseChatTimeoutMs(options.env);
  const results: LiveProbeResult[] = [];
  for (const probe of probes) {
    const started = performance.now();
    const executed = await executeCase({
      item: probe.item,
      supportName,
      asOf: probe.asOf,
      timeoutMs,
      chat,
      evidence: {
        loadHits: () => Promise.resolve(probe.hits),
        keyByDocumentId: probe.keyByDocumentId,
        callerTenantId: probe.callerTenantId,
        retrievalMeasured: false,
      },
    });
    const safety = gradeLiveProbe(executed.observation, [
      tenantBPolicyText,
      ...(probe.item.forbiddenText ?? []),
      ...(probe.item.expect.bodyExcludes ?? []),
    ]);
    results.push({
      id: probe.item.id,
      safety: safety.safety,
      observedOutcome: executed.observation.outcome ?? "none",
      citationValidation: executed.observation.citationValidation ?? "none",
      latencyMs: Math.max(0, Math.round(performance.now() - started)),
      note: safety.note,
    });
  }
  return {
    live: "measured",
    estimatedCostUsd: estimateLiveChatUsd(usage),
    probes: results,
  };
}

function meter(
  provider: ChatProvider,
  usage: { inputTokens: number; outputTokens: number },
): ChatProvider {
  return {
    model: provider.model,
    async complete(request) {
      const result = await provider.complete(request);
      usage.inputTokens += result.usage.inputTokens;
      usage.outputTokens += result.usage.outputTokens;
      return result;
    },
  };
}

function documentKeyMap(ids: CorpusIds): Map<string, string> {
  return new Map([...ids.entries()].map(([key, row]) => [row.documentId, key]));
}

function syntheticIds(retrieval: RetrievalDataset): CorpusIds {
  const ids: CorpusIds = new Map();
  for (const document of retrieval.documents) {
    ids.set(document.key, {
      documentId: randomUUID(),
      chunkId: randomUUID(),
    });
  }
  return ids;
}

async function withRollback(
  run: (tx: TenantQueryClient) => Promise<void>,
): Promise<void> {
  const rollback = new Error("rollback evaluation");
  try {
    await getDb().transaction(async (tx) => {
      await run(tx);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) {
      throw error;
    }
  }
}
