import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";

import { insertAuditEvent } from "@/server/db/audit";
import {
  documentChunks,
  documents,
  embeddingDimensions,
} from "@/server/db/schema";
import type { TenantQueryClient } from "@/server/db/tenant-queries";
import { chunkDocument, type DocumentChunk } from "@/server/documents/chunk";
import {
  EmbeddingError,
  type EmbeddingProvider,
} from "@/server/documents/embed";
import {
  DOCUMENT_MAX_BYTES,
  SYNC_INGEST_MAX_BYTES,
  type FailureReason,
} from "@/server/documents/limits";

type DocumentRow = typeof documents.$inferSelect;

export type DocumentActor = {
  userId: string;
  tenantId: string;
};

export type IngestInput = {
  title: string;
  source: string;
  documentType: "markdown" | "text";
  content: string;
  effectiveDate: string | null;
  newVersion: boolean;
  supersedesDocumentId: string | null;
};

export type DocumentView = {
  id: string;
  tenantId: string;
  title: string;
  source: string;
  documentType: "markdown" | "text";
  version: number;
  publication: "draft" | "published" | "retired";
  ingestionStatus: "pending" | "ready" | "failed";
  failureReason: FailureReason | null;
  checksum: string;
  isCurrent: boolean;
  supersedesDocumentId: string | null;
  effectiveDate: string | null;
  uploadedByUserId: string;
  createdAt: string;
  updatedAt: string;
  retiredAt: string | null;
  body?: string;
};

export type IngestDeps = {
  db: TenantQueryClient;
  embedder: EmbeddingProvider;
  now?: () => Date;
};

export class DocumentNotFoundError extends Error {
  constructor() {
    super("Document was not found. Values are omitted.");
    this.name = "DocumentNotFoundError";
  }
}

export class DocumentRejectedError extends Error {
  readonly code: "validation_failed" | "empty_content" | "payload_too_large";

  constructor(
    code: "validation_failed" | "empty_content" | "payload_too_large",
  ) {
    super("Document was rejected. Values are omitted.");
    this.name = "DocumentRejectedError";
    this.code = code;
  }
}

export class DocumentConflictError extends Error {
  readonly code: "not_ready" | "not_current" | "conflict";

  constructor(code: "not_ready" | "not_current" | "conflict") {
    super("Document cannot change. Values are omitted.");
    this.name = "DocumentConflictError";
    this.code = code;
  }
}

export function normalizeDocumentText(content: string): string {
  const withoutBom =
    content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  return withoutBom.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function documentChecksum(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export async function createDocument(
  actor: DocumentActor,
  input: IngestInput,
  deps: IngestDeps,
): Promise<{ document: DocumentView; created: boolean }> {
  const body = normalizeDocumentText(input.content);
  if (Buffer.byteLength(body, "utf8") > DOCUMENT_MAX_BYTES) {
    throw new DocumentRejectedError("payload_too_large");
  }
  if (body.trim().length === 0) {
    throw new DocumentRejectedError("empty_content");
  }
  const checksum = documentChecksum(body);
  if (!input.newVersion) {
    const existing = await findCurrentByChecksum(
      deps.db,
      actor.tenantId,
      checksum,
    );
    if (existing) {
      return { document: toView(existing, true), created: false };
    }
  }

  const previous = await previousVersion(actor, input, deps);
  const pieces = chunkDocument(input.documentType, body);
  const tooLarge = Buffer.byteLength(body, "utf8") > SYNC_INGEST_MAX_BYTES;
  if (!tooLarge && pieces.length === 0) {
    throw new DocumentRejectedError("empty_content");
  }

  const id = randomUUID();
  const stamp = deps.now ? deps.now() : new Date();
  try {
    await deps.db.insert(documents).values({
      id,
      tenantId: actor.tenantId,
      title: input.title,
      source: input.source,
      documentType: input.documentType,
      version: previous ? previous.version + 1 : 1,
      checksum,
      body,
      uploadedByUserId: actor.userId,
      effectiveDate: input.effectiveDate,
      ingestionStatus: "pending",
      isCurrent: !previous,
      supersedesDocumentId: previous?.id ?? null,
      createdAt: stamp,
      updatedAt: stamp,
    });
  } catch (error) {
    if (!previous && isUniqueViolation(error)) {
      const existing = await findCurrentByChecksum(
        deps.db,
        actor.tenantId,
        checksum,
      );
      if (existing) {
        return { document: toView(existing, true), created: false };
      }
    }
    console.error("document ingestion failed: ingestion_failed");
    throw error;
  }

  if (tooLarge) {
    const failed = await failDocument(
      deps,
      actor,
      id,
      "too_large_for_sync_ingestion",
    );
    return { document: failed, created: true };
  }

  try {
    const vectors = await embedChunks(deps.embedder, pieces);
    const document = await storeChunks(deps, actor, {
      id,
      version: previous ? previous.version + 1 : 1,
      previousId: previous?.id ?? null,
      pieces,
      vectors,
      action: "document.create",
    });
    return { document, created: true };
  } catch (error) {
    if (error instanceof DocumentConflictError) {
      await failDocument(deps, actor, id, "ingestion_failed");
      throw error;
    }
    const reason =
      error instanceof EmbeddingError ? error.code : "ingestion_failed";
    console.error(`document ingestion failed: ${reason}`);
    const failed = await failDocument(deps, actor, id, reason);
    return { document: failed, created: true };
  }
}

export async function listDocuments(
  db: TenantQueryClient,
  tenantId: string,
): Promise<DocumentView[]> {
  const rows = await db
    .select()
    .from(documents)
    .where(eq(documents.tenantId, tenantId))
    .orderBy(desc(documents.createdAt));
  return rows.map((row) => toView(row, false));
}

export async function getDocument(
  db: TenantQueryClient,
  tenantId: string,
  documentId: string,
): Promise<DocumentView> {
  const row = await findDocument(db, tenantId, documentId);
  if (!row) {
    throw new DocumentNotFoundError();
  }
  return toView(row, true);
}

export async function publishDocument(
  actor: DocumentActor,
  documentId: string,
  deps: IngestDeps,
): Promise<DocumentView> {
  const row = await requireRow(deps.db, actor.tenantId, documentId);
  if (!row.isCurrent || row.publication === "retired") {
    throw new DocumentConflictError("not_current");
  }
  if (row.ingestionStatus !== "ready") {
    throw new DocumentConflictError("not_ready");
  }
  if (row.publication === "published") {
    return toView(row, true);
  }
  const now = new Date();
  await deps.db.transaction(async (tx) => {
    await tx
      .update(documents)
      .set({ publication: "published", updatedAt: now })
      .where(
        and(eq(documents.id, row.id), eq(documents.tenantId, actor.tenantId)),
      );
    await audit(tx, actor, "document.publish", row.id);
  });
  return reload(deps.db, actor.tenantId, row.id);
}

export async function retireDocument(
  actor: DocumentActor,
  documentId: string,
  deps: IngestDeps,
): Promise<DocumentView> {
  const row = await requireRow(deps.db, actor.tenantId, documentId);
  if (row.publication === "retired") {
    return toView(row, true);
  }
  const now = new Date();
  await deps.db.transaction(async (tx) => {
    await tx
      .update(documents)
      .set({
        publication: "retired",
        isCurrent: false,
        retiredAt: now,
        updatedAt: now,
      })
      .where(
        and(eq(documents.id, row.id), eq(documents.tenantId, actor.tenantId)),
      );
    await audit(tx, actor, "document.retire", row.id);
  });
  return reload(deps.db, actor.tenantId, row.id);
}

export async function reindexDocument(
  actor: DocumentActor,
  documentId: string,
  deps: IngestDeps,
): Promise<DocumentView> {
  const row = await requireRow(deps.db, actor.tenantId, documentId);
  if (row.publication === "retired") {
    throw new DocumentConflictError("not_current");
  }
  const retryVersion =
    !row.isCurrent &&
    row.ingestionStatus !== "ready" &&
    row.supersedesDocumentId !== null;
  if (!row.isCurrent && !retryVersion) {
    throw new DocumentConflictError("not_current");
  }
  if (Buffer.byteLength(row.body, "utf8") > SYNC_INGEST_MAX_BYTES) {
    return failDocument(deps, actor, row.id, "too_large_for_sync_ingestion");
  }
  const pieces = chunkDocument(row.documentType, row.body);
  if (pieces.length === 0) {
    return failDocument(deps, actor, row.id, "ingestion_failed");
  }
  try {
    const vectors = await embedChunks(deps.embedder, pieces);
    return await storeChunks(deps, actor, {
      id: row.id,
      version: row.version,
      previousId: retryVersion ? row.supersedesDocumentId : null,
      pieces,
      vectors,
      action: "document.reindex",
    });
  } catch (error) {
    if (error instanceof DocumentConflictError) {
      await failDocument(deps, actor, row.id, "ingestion_failed");
      throw error;
    }
    const reason =
      error instanceof EmbeddingError ? error.code : "ingestion_failed";
    console.error(`document ingestion failed: ${reason}`);
    return failDocument(deps, actor, row.id, reason);
  }
}

async function previousVersion(
  actor: DocumentActor,
  input: IngestInput,
  deps: IngestDeps,
): Promise<DocumentRow | null> {
  if (!input.newVersion) {
    return null;
  }
  if (!input.supersedesDocumentId) {
    throw new DocumentRejectedError("validation_failed");
  }
  const previous = await findDocument(
    deps.db,
    actor.tenantId,
    input.supersedesDocumentId,
  );
  if (!previous) {
    throw new DocumentNotFoundError();
  }
  if (!previous.isCurrent || previous.publication === "retired") {
    throw new DocumentConflictError("not_current");
  }
  return previous;
}

async function embedChunks(
  embedder: EmbeddingProvider,
  pieces: readonly DocumentChunk[],
): Promise<number[][]> {
  let vectors: number[][];
  try {
    vectors = await embedder.embed(pieces.map((piece) => piece.text));
  } catch (error) {
    if (error instanceof EmbeddingError) {
      throw error;
    }
    throw new EmbeddingError("embedding_failed");
  }
  if (
    vectors.length !== pieces.length ||
    vectors.some(
      (vector) =>
        vector.length !== embeddingDimensions ||
        vector.some((value) => !Number.isFinite(value)),
    )
  ) {
    throw new EmbeddingError("embedding_failed");
  }
  return vectors;
}

async function storeChunks(
  deps: IngestDeps,
  actor: DocumentActor,
  input: {
    id: string;
    version: number;
    previousId: string | null;
    pieces: readonly DocumentChunk[];
    vectors: readonly number[][];
    action: "document.create" | "document.reindex";
  },
): Promise<DocumentView> {
  const now = new Date();
  await deps.db.transaction(async (tx) => {
    if (input.previousId) {
      const superseded = await tx
        .update(documents)
        .set({ isCurrent: false, updatedAt: now })
        .where(
          and(
            eq(documents.id, input.previousId),
            eq(documents.tenantId, actor.tenantId),
            eq(documents.isCurrent, true),
          ),
        )
        .returning({ id: documents.id });
      if (superseded.length !== 1) {
        throw new DocumentConflictError("conflict");
      }
    }
    await tx
      .delete(documentChunks)
      .where(
        and(
          eq(documentChunks.documentId, input.id),
          eq(documentChunks.tenantId, actor.tenantId),
        ),
      );
    await tx.insert(documentChunks).values(
      input.pieces.map((piece, index) => {
        const embedding = input.vectors[index];
        if (!embedding) {
          throw new EmbeddingError("embedding_failed");
        }
        return {
          tenantId: actor.tenantId,
          documentId: input.id,
          documentVersion: input.version,
          chunkIndex: piece.index,
          section: piece.section,
          content: piece.text,
          embedding,
        };
      }),
    );
    await tx
      .update(documents)
      .set({
        ingestionStatus: "ready",
        failureReason: null,
        isCurrent: true,
        updatedAt: now,
      })
      .where(
        and(eq(documents.id, input.id), eq(documents.tenantId, actor.tenantId)),
      );
    await audit(tx, actor, input.action, input.id);
    if (input.previousId) {
      await audit(tx, actor, "document.supersede", input.id);
    }
  });
  return reload(deps.db, actor.tenantId, input.id);
}

async function failDocument(
  deps: IngestDeps,
  actor: DocumentActor,
  documentId: string,
  reason: FailureReason,
): Promise<DocumentView> {
  const now = new Date();
  await deps.db.transaction(async (tx) => {
    await tx
      .delete(documentChunks)
      .where(
        and(
          eq(documentChunks.documentId, documentId),
          eq(documentChunks.tenantId, actor.tenantId),
        ),
      );
    await tx
      .update(documents)
      .set({
        ingestionStatus: "failed",
        failureReason: reason,
        updatedAt: now,
      })
      .where(
        and(
          eq(documents.id, documentId),
          eq(documents.tenantId, actor.tenantId),
        ),
      );
    await audit(tx, actor, "document.ingestion_failed", documentId);
  });
  return reload(deps.db, actor.tenantId, documentId);
}

async function requireRow(
  db: TenantQueryClient,
  tenantId: string,
  documentId: string,
): Promise<DocumentRow> {
  const row = await findDocument(db, tenantId, documentId);
  if (!row) {
    throw new DocumentNotFoundError();
  }
  return row;
}

async function reload(
  db: TenantQueryClient,
  tenantId: string,
  documentId: string,
): Promise<DocumentView> {
  const row = await findDocument(db, tenantId, documentId);
  if (!row) {
    throw new DocumentNotFoundError();
  }
  return toView(row, true);
}

async function findDocument(
  db: TenantQueryClient,
  tenantId: string,
  documentId: string,
): Promise<DocumentRow | null> {
  const [row] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.tenantId, tenantId)))
    .limit(1);
  return row ?? null;
}

async function findCurrentByChecksum(
  db: TenantQueryClient,
  tenantId: string,
  checksum: string,
): Promise<DocumentRow | null> {
  const [row] = await db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.tenantId, tenantId),
        eq(documents.checksum, checksum),
        eq(documents.isCurrent, true),
      ),
    )
    .limit(1);
  return row ?? null;
}

function toView(row: DocumentRow, includeBody: boolean): DocumentView {
  const view: DocumentView = {
    id: row.id,
    tenantId: row.tenantId,
    title: row.title,
    source: row.source,
    documentType: row.documentType,
    version: row.version,
    publication: row.publication,
    ingestionStatus: row.ingestionStatus,
    failureReason: row.failureReason as FailureReason | null,
    checksum: row.checksum,
    isCurrent: row.isCurrent,
    supersedesDocumentId: row.supersedesDocumentId,
    effectiveDate: row.effectiveDate,
    uploadedByUserId: row.uploadedByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    retiredAt: row.retiredAt ? row.retiredAt.toISOString() : null,
  };
  if (includeBody) {
    view.body = row.body;
  }
  return view;
}

async function audit(
  db: TenantQueryClient,
  actor: DocumentActor,
  action: string,
  documentId: string,
): Promise<void> {
  await insertAuditEvent(db, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action,
    targetType: "document",
    targetId: documentId,
  });
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  if ("code" in error && error.code === "23505") {
    return true;
  }
  return "cause" in error && isUniqueViolation(error.cause);
}
