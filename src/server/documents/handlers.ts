import { z } from "zod";

import {
  accessErrorResponse,
  requirePermission,
  type AccessDeps,
} from "@/server/auth/access";
import { getDb } from "@/server/db/client";
import type { TenantQueryClient } from "@/server/db/tenant-queries";
import {
  createEmbeddingProvider,
  type EmbeddingProvider,
} from "@/server/documents/embed";
import {
  createDocument,
  DocumentConflictError,
  DocumentNotFoundError,
  DocumentRejectedError,
  getDocument,
  listDocuments,
  publishDocument,
  reindexDocument,
  retireDocument,
  type IngestDeps,
  type IngestInput,
} from "@/server/documents/ingest";
import { DOCUMENT_MAX_BYTES } from "@/server/documents/limits";

const requestMarginBytes = 16 * 1024;

const createBody = z
  .object({
    tenantId: z.uuid(),
    title: z.string().trim().min(1).max(200),
    source: z.string().trim().min(1).max(500),
    documentType: z.enum(["markdown", "text"]),
    content: z.string().min(1),
    effectiveDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    newVersion: z.boolean().optional(),
    supersedesDocumentId: z.uuid().nullable().optional(),
  })
  .strict();

const tenantBody = z
  .object({
    tenantId: z.uuid(),
  })
  .strict();

export type DocumentHandlerDeps = {
  authorize: typeof requirePermission;
  db: () => TenantQueryClient;
  embedder: () => EmbeddingProvider;
  accessDeps?: AccessDeps;
};

export function createDocumentHandlers(
  overrides?: Partial<DocumentHandlerDeps>,
) {
  const deps: DocumentHandlerDeps = {
    authorize: requirePermission,
    db: getDb,
    embedder: () => createEmbeddingProvider(process.env),
    ...overrides,
  };

  return {
    async create(request: Request): Promise<Response> {
      return guard(async () => {
        const body = await readJson(request, createBody);
        if (body instanceof Response) {
          return body;
        }
        const newVersion = body.newVersion ?? false;
        if (newVersion && !body.supersedesDocumentId) {
          return validationFailed();
        }
        if (!newVersion && body.supersedesDocumentId) {
          return validationFailed();
        }
        if (body.effectiveDate && !isRealDate(body.effectiveDate)) {
          return validationFailed();
        }
        const access = await deps.authorize(
          request,
          "document:create",
          { tenantId: body.tenantId },
          deps.accessDeps,
        );
        if (newVersion) {
          await deps.authorize(
            request,
            "document:update",
            { tenantId: body.tenantId },
            deps.accessDeps,
          );
        }
        const input: IngestInput = {
          title: body.title,
          source: body.source,
          documentType: body.documentType,
          content: body.content,
          effectiveDate: body.effectiveDate ?? null,
          newVersion,
          supersedesDocumentId: body.supersedesDocumentId ?? null,
        };
        const result = await createDocument(access, input, serviceDeps(deps));
        return Response.json(result, { status: result.created ? 201 : 200 });
      });
    },

    async list(request: Request): Promise<Response> {
      return guard(async () => {
        const tenantId = tenantFromQuery(request);
        if (tenantId instanceof Response) {
          return tenantId;
        }
        const access = await deps.authorize(
          request,
          "document:read",
          { tenantId },
          deps.accessDeps,
        );
        const documents = await listDocuments(deps.db(), access.tenantId);
        return Response.json({ documents });
      });
    },

    async read(
      request: Request,
      context: { params: Promise<{ documentId: string }> },
    ): Promise<Response> {
      return guard(async () => {
        const documentId = await documentIdFrom(context);
        if (documentId instanceof Response) {
          return documentId;
        }
        const tenantId = tenantFromQuery(request);
        if (tenantId instanceof Response) {
          return tenantId;
        }
        const access = await deps.authorize(
          request,
          "document:read",
          { tenantId },
          deps.accessDeps,
        );
        const document = await getDocument(
          deps.db(),
          access.tenantId,
          documentId,
        );
        return Response.json({ document });
      });
    },

    async publish(
      request: Request,
      context: { params: Promise<{ documentId: string }> },
    ): Promise<Response> {
      return change(deps, request, context, "document:update", publishDocument);
    },

    async retire(
      request: Request,
      context: { params: Promise<{ documentId: string }> },
    ): Promise<Response> {
      return change(deps, request, context, "document:retire", retireDocument);
    },

    async reindex(
      request: Request,
      context: { params: Promise<{ documentId: string }> },
    ): Promise<Response> {
      return change(deps, request, context, "document:update", reindexDocument);
    },
  };
}

function serviceDeps(deps: DocumentHandlerDeps): IngestDeps {
  return {
    // The client is opened only when a statement runs, so a rejected body
    // does not touch the pool.
    get db() {
      return deps.db();
    },
    get embedder() {
      return deps.embedder();
    },
  };
}

async function change(
  deps: DocumentHandlerDeps,
  request: Request,
  context: { params: Promise<{ documentId: string }> },
  permission: "document:update" | "document:retire",
  run: (
    actor: { userId: string; tenantId: string },
    documentId: string,
    service: IngestDeps,
  ) => Promise<unknown>,
): Promise<Response> {
  return guard(async () => {
    const documentId = await documentIdFrom(context);
    if (documentId instanceof Response) {
      return documentId;
    }
    const body = await readJson(request, tenantBody);
    if (body instanceof Response) {
      return body;
    }
    const access = await deps.authorize(
      request,
      permission,
      { tenantId: body.tenantId },
      deps.accessDeps,
    );
    const document = await run(access, documentId, serviceDeps(deps));
    return Response.json({ document });
  });
}

async function guard(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    const response = documentErrorResponse(error);
    if (response) {
      return response;
    }
    console.error("document request failed");
    return Response.json({ error: "ingestion_failed" }, { status: 500 });
  }
}

export function documentErrorResponse(error: unknown): Response | null {
  const access = accessErrorResponse(error);
  if (access) {
    return access;
  }
  if (error instanceof DocumentRejectedError) {
    const status = error.code === "payload_too_large" ? 413 : 400;
    return Response.json({ error: error.code }, { status });
  }
  if (error instanceof DocumentNotFoundError) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  if (error instanceof DocumentConflictError) {
    return Response.json({ error: error.code }, { status: 409 });
  }
  return null;
}

async function readJson<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<T | Response> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (
    Number.isFinite(declared) &&
    declared > DOCUMENT_MAX_BYTES + requestMarginBytes
  ) {
    return Response.json({ error: "payload_too_large" }, { status: 413 });
  }
  const raw = await request.text();
  if (
    Buffer.byteLength(raw, "utf8") >
    DOCUMENT_MAX_BYTES + requestMarginBytes
  ) {
    return Response.json({ error: "payload_too_large" }, { status: 413 });
  }
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      return validationFailed();
    }
    return parsed.data;
  } catch {
    return validationFailed();
  }
}

function tenantFromQuery(request: Request): string | Response {
  const tenantId = new URL(request.url).searchParams.get("tenantId");
  if (!tenantId || !z.uuid().safeParse(tenantId).success) {
    return validationFailed();
  }
  return tenantId;
}

async function documentIdFrom(context: {
  params: Promise<{ documentId: string }>;
}): Promise<string | Response> {
  const { documentId } = await context.params;
  if (!z.uuid().safeParse(documentId).success) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  return documentId;
}

function validationFailed(): Response {
  return Response.json({ error: "validation_failed" }, { status: 400 });
}

function isRealDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match?.[1] || !match[2] || !match[3]) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}
