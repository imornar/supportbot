import "server-only";

import { randomUUID } from "node:crypto";

import { documentChunks, documents, tenants, users } from "@/server/db/schema";
import type { TenantQueryClient } from "@/server/db/tenant-queries";
import { documentChecksum } from "@/server/documents/ingest";
import type { RetrievalDataset } from "@/server/retrieval/dataset";
import { fixtureEmbedding } from "@/server/retrieval/fixture-embedding";

export const tenantBPolicyText = "Tenant B lamp policy stays in tenant B.";

export type CorpusIds = Map<string, { documentId: string; chunkId: string }>;

export async function seedEvaluationCorpus(
  tx: TenantQueryClient,
  dataset: RetrievalDataset,
  tenantId: string,
  userId: string,
): Promise<CorpusIds> {
  await tx.insert(tenants).values({
    id: tenantId,
    slug: slug("a"),
    name: "Evaluation A",
  });
  await tx.insert(users).values({
    id: userId,
    email: `eval-${userId.slice(0, 8)}@example.com`,
    displayName: "Evaluation Tester",
  });
  const ids: CorpusIds = new Map();
  for (const document of dataset.documents) {
    const documentId = randomUUID();
    const chunkId = randomUUID();
    ids.set(document.key, { documentId, chunkId });
    await insertFixtureDocument(tx, {
      documentId,
      chunkId,
      tenantId,
      userId,
      title: document.title,
      source: document.source,
      text: document.text,
      section: document.section,
      basis: document.basis,
      publication: document.publication,
      isCurrent: document.isCurrent,
      ingestionStatus: document.ingestionStatus,
      effectiveDate: document.effectiveDate,
    });
  }
  return ids;
}

export async function seedOtherTenantPolicy(
  tx: TenantQueryClient,
  input: {
    tenantId: string;
    userId: string;
    shippingBasis: number;
    text: string;
  },
): Promise<string> {
  await tx.insert(tenants).values({
    id: input.tenantId,
    slug: slug("b"),
    name: "Evaluation B",
  });
  const documentId = randomUUID();
  await insertFixtureDocument(tx, {
    documentId,
    chunkId: randomUUID(),
    tenantId: input.tenantId,
    userId: input.userId,
    title: "Tenant B lamps",
    source: "fixtures/evaluation/tenant-b.md",
    text: input.text,
    section: "Other tenant",
    basis: input.shippingBasis,
    publication: "published",
    isCurrent: true,
    ingestionStatus: "ready",
    effectiveDate: null,
  });
  return documentId;
}

async function insertFixtureDocument(
  tx: TenantQueryClient,
  document: {
    documentId: string;
    chunkId: string;
    tenantId: string;
    userId: string;
    title: string;
    source: string;
    text: string;
    section: string;
    basis: number;
    publication: "draft" | "published" | "retired";
    isCurrent: boolean;
    ingestionStatus: "ready" | "failed";
    effectiveDate: string | null;
  },
): Promise<void> {
  await tx.insert(documents).values({
    id: document.documentId,
    tenantId: document.tenantId,
    title: document.title,
    source: document.source,
    documentType: "text",
    version: 1,
    publication: document.publication,
    checksum: documentChecksum(document.text),
    body: document.text,
    uploadedByUserId: document.userId,
    effectiveDate: document.effectiveDate,
    ingestionStatus: document.ingestionStatus,
    failureReason:
      document.ingestionStatus === "failed" ? "embedding_failed" : null,
    isCurrent: document.isCurrent,
  });
  await tx.insert(documentChunks).values({
    id: document.chunkId,
    tenantId: document.tenantId,
    documentId: document.documentId,
    documentVersion: 1,
    chunkIndex: 0,
    section: document.section,
    content: document.text,
    embedding: fixtureEmbedding([{ basis: document.basis, weight: 1 }]),
  });
}

function slug(label: string): string {
  return `eval-${label}-${randomUUID().slice(0, 8)}`;
}
