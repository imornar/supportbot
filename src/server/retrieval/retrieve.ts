import "server-only";

import { and, eq, isNull, lte, or, sql } from "drizzle-orm";

import {
  documentChunks,
  documents,
  embeddingDimensions,
} from "@/server/db/schema";
import type { TenantQueryClient } from "@/server/db/tenant-queries";
import {
  assertRetrievalSettings,
  type RetrievalSettings,
} from "@/server/retrieval/settings";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type RetrievedEvidence = {
  chunkId: string;
  documentId: string;
  tenantId: string;
  title: string;
  section: string | null;
  text: string;
  score: number;
  documentVersion: number;
  effectiveDate: string | null;
};

export class RetrievalQueryError extends Error {
  readonly code: "invalid_tenant" | "invalid_embedding" | "invalid_date";

  constructor(code: RetrievalQueryError["code"]) {
    super("Retrieval query was rejected. Values are omitted.");
    this.name = "RetrievalQueryError";
    this.code = code;
  }
}

export type RetrievalQuery = {
  tenantId: string;
  embedding: readonly number[];
  settings: RetrievalSettings;
  asOf: string;
};

/**
 * `tenantId` is the server-resolved tenant. The predicate that applies it is
 * `document_chunks.tenant_id`. The join only checks that the document row
 * belongs to the same tenant as that chunk. This function does not read a
 * tenant id from the model or from request JSON. `asOf` is the server's
 * calendar date, used when a document has an effective date.
 */
export async function retrieveEvidence(
  db: TenantQueryClient,
  input: RetrievalQuery,
): Promise<RetrievedEvidence[]> {
  assertRetrievalSettings(input.settings);
  if (!uuidPattern.test(input.tenantId)) {
    throw new RetrievalQueryError("invalid_tenant");
  }
  if (!isIsoDate(input.asOf)) {
    throw new RetrievalQueryError("invalid_date");
  }
  const literal = toVectorLiteral(input.embedding);
  const rows = await db
    .select({
      chunkId: documentChunks.id,
      documentId: documents.id,
      tenantId: documentChunks.tenantId,
      title: documents.title,
      section: documentChunks.section,
      text: documentChunks.content,
      score: similarityScore(literal),
      documentVersion: documents.version,
      effectiveDate: documents.effectiveDate,
    })
    .from(documentChunks)
    .innerJoin(
      documents,
      and(
        eq(documents.id, documentChunks.documentId),
        eq(documents.tenantId, documentChunks.tenantId),
        eq(documents.version, documentChunks.documentVersion),
      ),
    )
    .where(
      and(
        eq(documentChunks.tenantId, input.tenantId),
        eq(documents.publication, "published"),
        eq(documents.isCurrent, true),
        eq(documents.ingestionStatus, "ready"),
        or(
          isNull(documents.effectiveDate),
          lte(documents.effectiveDate, input.asOf),
        ),
        sql`${similarityScore(literal)} >= ${input.settings.similarityThreshold}`,
      ),
    )
    .orderBy(
      sql`${similarityScore(literal)} desc`,
      documents.title,
      documentChunks.chunkIndex,
    )
    .limit(input.settings.topK);

  return rows.map((row) => {
    const score = typeof row.score === "number" ? row.score : Number(row.score);
    if (!Number.isFinite(score)) {
      throw new RetrievalQueryError("invalid_embedding");
    }
    return { ...row, score };
  });
}

function similarityScore(literal: string) {
  return sql<number>`1 - (${documentChunks.embedding} <=> CAST(${literal} AS vector))`;
}

function toVectorLiteral(values: readonly number[]): string {
  if (
    values.length !== embeddingDimensions ||
    values.some((value) => !Number.isFinite(value))
  ) {
    throw new RetrievalQueryError("invalid_embedding");
  }
  let magnitude = 0;
  for (const value of values) {
    magnitude += value * value;
  }
  if (magnitude === 0) {
    throw new RetrievalQueryError("invalid_embedding");
  }
  return `[${values.join(",")}]`;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}
