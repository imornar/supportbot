import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  cosineSimilarity,
  fixtureEmbedding,
} from "@/server/retrieval/fixture-embedding";
import {
  retrievalDatasetSchema,
  type RetrievalDataset,
  type RetrievalDatasetQuery,
} from "@/server/retrieval/dataset";
import { retrieveEvidence } from "@/server/retrieval/retrieve";
import {
  defaultRetrievalSimilarityThreshold,
  defaultRetrievalTopK,
  parseRetrievalSettings,
} from "@/server/retrieval/settings";
import type { TenantQueryClient } from "@/server/db/tenant-queries";

const plantedDatabaseUrl =
  "postgresql://user:super-secret-password@db.internal:5432/supportpilot";

function loadDataset(): RetrievalDataset {
  const raw = readFileSync(
    path.join(process.cwd(), "fixtures/retrieval/dataset.json"),
    "utf8",
  );
  return retrievalDatasetSchema.parse(JSON.parse(raw));
}

function predictedKeys(
  dataset: RetrievalDataset,
  query: RetrievalDatasetQuery,
): string[] {
  const embedding = fixtureEmbedding(query.components);
  return dataset.documents
    .filter(
      (document) =>
        document.publication === "published" &&
        document.isCurrent &&
        document.ingestionStatus === "ready" &&
        (document.effectiveDate === null ||
          document.effectiveDate <= dataset.asOf),
    )
    .map((document) => ({
      key: document.key,
      title: document.title,
      score: cosineSimilarity(
        embedding,
        fixtureEmbedding([{ basis: document.basis, weight: 1 }]),
      ),
    }))
    .filter((hit) => hit.score >= dataset.similarityThreshold)
    .sort(
      (left, right) =>
        right.score - left.score || left.title.localeCompare(right.title),
    )
    .slice(0, query.topK ?? dataset.topK)
    .map((hit) => hit.key);
}

function words(value: string): string[] {
  return value.toLowerCase().match(/[a-z]{4,}/g) ?? [];
}

describe("retrieval dataset", () => {
  const dataset = loadDataset();

  it("labels match the published current ready filters and the configured rank", () => {
    const keys = new Set(dataset.documents.map((document) => document.key));
    const bases = dataset.documents.map((document) => document.basis);
    expect(new Set(bases).size).toBe(bases.length);
    expect(dataset.similarityThreshold).toBe(0.3);
    expect(dataset.topK).toBe(5);

    for (const query of dataset.queries) {
      expect(
        query.expected.every((key) => keys.has(key)),
        query.id,
      ).toBe(true);
      expect(predictedKeys(dataset, query), query.id).toEqual(query.expected);
    }
  });

  it("keeps vector-only because a keyword rank picks the wrong article", () => {
    const query = dataset.queries.find((item) => item.id === "lexical-trap");
    expect(query).toBeDefined();
    if (!query) {
      return;
    }
    const tokens = new Set(words(query.question));
    const visible = dataset.documents.filter(
      (document) =>
        document.publication === "published" &&
        document.isCurrent &&
        document.ingestionStatus === "ready",
    );
    const keywordWinner = visible
      .map((document) => ({
        key: document.key,
        score: words(document.text).filter((word) => tokens.has(word)).length,
      }))
      .sort(
        (left, right) =>
          right.score - left.score || left.key.localeCompare(right.key),
      )[0];
    expect(predictedKeys(dataset, query)).toEqual(["shipping"]);
    expect(keywordWinner?.key).toBe("returns");
  });
});

describe("parseRetrievalSettings", () => {
  it("uses defaults when the variables are unset", () => {
    expect(parseRetrievalSettings({})).toEqual({
      topK: defaultRetrievalTopK,
      similarityThreshold: defaultRetrievalSimilarityThreshold,
    });
    expect(
      parseRetrievalSettings({
        RETRIEVAL_TOP_K: "   ",
        RETRIEVAL_SIMILARITY_THRESHOLD: "",
      }),
    ).toEqual({
      topK: defaultRetrievalTopK,
      similarityThreshold: defaultRetrievalSimilarityThreshold,
    });
  });

  it("reads configured limits and omits secret values from errors", () => {
    expect(
      parseRetrievalSettings({
        RETRIEVAL_TOP_K: "8",
        RETRIEVAL_SIMILARITY_THRESHOLD: "0.55",
        DATABASE_URL: plantedDatabaseUrl,
      }),
    ).toEqual({ topK: 8, similarityThreshold: 0.55 });

    expect(() =>
      parseRetrievalSettings({
        RETRIEVAL_TOP_K: "0",
        DATABASE_URL: plantedDatabaseUrl,
      }),
    ).toThrow(/RETRIEVAL_TOP_K/);
    expect(() =>
      parseRetrievalSettings({
        RETRIEVAL_SIMILARITY_THRESHOLD: "1.5",
        DATABASE_URL: plantedDatabaseUrl,
      }),
    ).toThrow(/RETRIEVAL_SIMILARITY_THRESHOLD/);

    try {
      parseRetrievalSettings({
        RETRIEVAL_TOP_K: "50",
        DATABASE_URL: plantedDatabaseUrl,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain("super-secret-password");
      expect(message).not.toContain("db.internal");
    }
  });
});

describe("retrieveEvidence input checks", () => {
  const settings = parseRetrievalSettings({});
  const db = {} as TenantQueryClient;

  it("rejects a tenant id, a date, and an embedding before querying", async () => {
    await expect(
      retrieveEvidence(db, {
        tenantId: "tenant-a",
        embedding: fixtureEmbedding([{ basis: 0, weight: 1 }]),
        settings,
        asOf: "2026-11-08",
      }),
    ).rejects.toMatchObject({ code: "invalid_tenant" });

    await expect(
      retrieveEvidence(db, {
        tenantId: "00000000-0000-4000-8000-000000000001",
        embedding: fixtureEmbedding([{ basis: 0, weight: 1 }]),
        settings,
        asOf: "2026-02-31",
      }),
    ).rejects.toMatchObject({ code: "invalid_date" });

    await expect(
      retrieveEvidence(db, {
        tenantId: "00000000-0000-4000-8000-000000000001",
        embedding: [1],
        settings,
        asOf: "2026-11-08",
      }),
    ).rejects.toMatchObject({ code: "invalid_embedding" });

    await expect(
      retrieveEvidence(db, {
        tenantId: "00000000-0000-4000-8000-000000000001",
        embedding: fixtureEmbedding([]),
        settings,
        asOf: "2026-11-08",
      }),
    ).rejects.toMatchObject({ code: "invalid_embedding" });
  });
});
