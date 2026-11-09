import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { DEV_USER_HEADER } from "@/server/auth/dev-identity";
import { loadMembershipAccess } from "@/server/auth/membership-access";
import type { AccessDeps } from "@/server/auth/access";
import { closePool, getDb } from "@/server/db/client";
import {
  auditEvents,
  documentChunks,
  documents,
  roleAssignments,
  tenantMemberships,
  tenants,
  users,
} from "@/server/db/schema";
import { seedUsers } from "@/server/db/seed-data";
import type { TenantQueryClient } from "@/server/db/tenant-queries";
import { fakeEmbedder } from "@/server/documents/embed";
import { createDocumentHandlers } from "@/server/documents/handlers";
import { SYNC_INGEST_MAX_BYTES } from "@/server/documents/limits";

const databaseUrl = process.env.DATABASE_URL?.trim();
const rollback = new Error("rollback ingestion test");
const ken = seedUsers[1];
const casey = seedUsers[3];
const devEnv = {
  NODE_ENV: "test",
  SUPPORTPILOT_ALLOW_DEV_IDENTITY: "true",
};

describe.skipIf(!databaseUrl)("document ingestion", () => {
  afterAll(async () => {
    await closePool();
  });

  it("ingests text for a permitted member and keeps other tenants out", async () => {
    await withRollback(async (tx) => {
      const tenantA = randomUUID();
      const tenantB = randomUUID();
      await tx.insert(tenants).values([
        { id: tenantA, slug: slug("a"), name: "Ingest A" },
        { id: tenantB, slug: slug("b"), name: "Ingest B" },
      ]);
      await tx
        .insert(users)
        .values([
          { id: ken.id, email: ken.email, displayName: ken.displayName },
          {
            id: casey.id,
            email: casey.email,
            displayName: casey.displayName,
          },
        ])
        .onConflictDoNothing();
      const kenMembership = randomUUID();
      const caseyMembership = randomUUID();
      const kenOther = randomUUID();
      await tx.insert(tenantMemberships).values([
        { id: kenMembership, tenantId: tenantA, userId: ken.id },
        { id: caseyMembership, tenantId: tenantA, userId: casey.id },
        { id: kenOther, tenantId: tenantB, userId: ken.id },
      ]);
      await tx.insert(roleAssignments).values([
        {
          tenantId: tenantA,
          membershipId: kenMembership,
          role: "knowledge_manager",
        },
        { tenantId: tenantA, membershipId: caseyMembership, role: "customer" },
        {
          tenantId: tenantB,
          membershipId: kenOther,
          role: "knowledge_manager",
        },
      ]);

      const handlers = createDocumentHandlers({
        db: () => tx,
        embedder: () => fakeEmbedder(),
        accessDeps: accessFor(tx),
      });
      const denied = await handlers.create(
        upload(
          tenantA,
          casey.id,
          "Purple widget policy stays out of the audit log.",
        ),
      );
      expect(denied.status).toBe(403);
      expect(await countDocuments(tx, tenantA)).toBe(0);

      const created = await handlers.create(
        upload(
          tenantA,
          ken.id,
          "Purple widget policy stays out of the audit log.",
        ),
      );
      expect(created.status).toBe(201);
      const createdBody = (await created.json()) as {
        created: boolean;
        document: {
          id: string;
          ingestionStatus: string;
          failureReason: string | null;
          version: number;
          body?: string;
        };
      };
      expect(createdBody.created).toBe(true);
      expect(createdBody.document.ingestionStatus).toBe("ready");
      expect(createdBody.document.failureReason).toBeNull();
      expect(createdBody.document.version).toBe(1);

      const chunks = await tx
        .select()
        .from(documentChunks)
        .where(eq(documentChunks.documentId, createdBody.document.id));
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.every((chunk) => chunk.tenantId === tenantA)).toBe(true);
      expect(chunks.every((chunk) => chunk.documentVersion === 1)).toBe(true);
      expect(chunks[0]?.embedding).toHaveLength(1536);

      const duplicate = await handlers.create(
        upload(
          tenantA,
          ken.id,
          "Purple widget policy stays out of the audit log.",
        ),
      );
      expect(duplicate.status).toBe(200);
      const duplicateBody = (await duplicate.json()) as {
        created: boolean;
        document: { id: string };
      };
      expect(duplicateBody.created).toBe(false);
      expect(duplicateBody.document.id).toBe(createdBody.document.id);
      expect(await countDocuments(tx, tenantA)).toBe(1);

      const published = await handlers.publish(
        change(tenantA, ken.id, createdBody.document.id, "publish"),
        { params: Promise.resolve({ documentId: createdBody.document.id }) },
      );
      expect(published.status).toBe(200);
      expect(await published.json()).toMatchObject({
        document: { publication: "published", isCurrent: true },
      });

      const next = await handlers.create(
        upload(
          tenantA,
          ken.id,
          "Purple widget policy version two.",
          true,
          createdBody.document.id,
        ),
      );
      expect(next.status).toBe(201);
      const nextBody = (await next.json()) as {
        document: { id: string; version: number; isCurrent: boolean };
      };
      expect(nextBody.document.version).toBe(2);
      expect(nextBody.document.isCurrent).toBe(true);
      const previous = await tx
        .select({ isCurrent: documents.isCurrent })
        .from(documents)
        .where(eq(documents.id, createdBody.document.id));
      expect(previous).toEqual([{ isCurrent: false }]);

      const sameChecksum = await handlers.create(
        upload(
          tenantA,
          ken.id,
          "Purple widget policy version two.",
          true,
          nextBody.document.id,
        ),
      );
      expect(sameChecksum.status).toBe(201);
      const sameBody = (await sameChecksum.json()) as {
        created: boolean;
        document: { id: string; version: number };
      };
      expect(sameBody.created).toBe(true);
      expect(sameBody.document.version).toBe(3);
      expect(sameBody.document.id).not.toBe(nextBody.document.id);

      const otherTenant = await handlers.list(
        new Request(
          `http://localhost:3000/api/v1/documents?tenantId=${tenantB}`,
          { headers: { [DEV_USER_HEADER]: ken.id } },
        ),
      );
      expect(otherTenant.status).toBe(200);
      expect(await otherTenant.json()).toEqual({ documents: [] });

      const hidden = await handlers.read(
        new Request(
          `http://localhost:3000/api/v1/documents/${createdBody.document.id}?tenantId=${tenantB}`,
          { headers: { [DEV_USER_HEADER]: ken.id } },
        ),
        { params: Promise.resolve({ documentId: createdBody.document.id }) },
      );
      expect(hidden.status).toBe(404);

      const listed = await handlers.list(
        new Request(
          `http://localhost:3000/api/v1/documents?tenantId=${tenantA}`,
          { headers: { [DEV_USER_HEADER]: ken.id } },
        ),
      );
      const listedBody = (await listed.json()) as {
        documents: Array<{ body?: string }>;
      };
      expect(listedBody.documents.length).toBe(3);
      expect(
        listedBody.documents.every((document) => document.body === undefined),
      ).toBe(true);

      const failing = createDocumentHandlers({
        db: () => tx,
        embedder: () => ({
          model: "fake",
          dimensions: 1536,
          async embed() {
            throw new Error("sk-live-secret leaked from the provider");
          },
        }),
        accessDeps: accessFor(tx),
      });
      const failed = await failing.create(
        upload(
          tenantA,
          ken.id,
          "This embed must fail without echoing secrets.",
        ),
      );
      expect(failed.status).toBe(201);
      const failedText = await failed.text();
      expect(failedText).not.toContain("sk-live-secret");
      const failedBody = JSON.parse(failedText) as {
        document: {
          id: string;
          ingestionStatus: string;
          failureReason: string;
        };
      };
      expect(failedBody.document.ingestionStatus).toBe("failed");
      expect(failedBody.document.failureReason).toBe("embedding_failed");
      const failedChunks = await tx
        .select({ id: documentChunks.id })
        .from(documentChunks)
        .where(eq(documentChunks.documentId, failedBody.document.id));
      expect(failedChunks).toEqual([]);

      const notReady = await handlers.publish(
        change(tenantA, ken.id, failedBody.document.id, "publish"),
        { params: Promise.resolve({ documentId: failedBody.document.id }) },
      );
      expect(notReady.status).toBe(409);
      expect(await notReady.json()).toEqual({ error: "not_ready" });

      const restored = await handlers.reindex(
        change(tenantA, ken.id, failedBody.document.id, "reindex"),
        { params: Promise.resolve({ documentId: failedBody.document.id }) },
      );
      expect(restored.status).toBe(200);
      expect(await restored.json()).toMatchObject({
        document: { ingestionStatus: "ready", failureReason: null },
      });

      const tooBig = await handlers.create(
        upload(tenantA, ken.id, "c".repeat(SYNC_INGEST_MAX_BYTES + 1)),
      );
      expect(tooBig.status).toBe(201);
      expect(await tooBig.json()).toMatchObject({
        document: {
          ingestionStatus: "failed",
          failureReason: "too_large_for_sync_ingestion",
        },
      });

      const retired = await handlers.retire(
        change(tenantA, ken.id, sameBody.document.id, "retire"),
        { params: Promise.resolve({ documentId: sameBody.document.id }) },
      );
      expect(retired.status).toBe(200);
      const retiredBody = (await retired.json()) as {
        document: { id: string; publication: string; isCurrent: boolean };
      };
      expect(retiredBody.document.publication).toBe("retired");
      expect(retiredBody.document.isCurrent).toBe(false);
      const stillThere = await tx
        .select({ id: documents.id })
        .from(documents)
        .where(
          and(
            eq(documents.id, sameBody.document.id),
            eq(documents.tenantId, tenantA),
          ),
        );
      expect(stillThere).toHaveLength(1);

      const events = await tx
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.tenantId, tenantA));
      expect(events.some((event) => event.action === "document.create")).toBe(
        true,
      );
      expect(events.some((event) => event.action === "document.retire")).toBe(
        true,
      );
      expect(events.some((event) => event.actorUserId === ken.id)).toBe(true);
      const serialized = JSON.stringify(events);
      expect(serialized).not.toContain("Purple widget");
      expect(serialized).not.toContain("sk-live-secret");
    });
  });
});

function accessFor(tx: TenantQueryClient): AccessDeps {
  return {
    env: devEnv,
    readSession: async () => null,
    findUserBySubject: async () => null,
    findMembership: (userId, tenantId) =>
      loadMembershipAccess(tx, userId, tenantId),
  };
}

function upload(
  tenantId: string,
  userId: string,
  content: string,
  newVersion = false,
  supersedesDocumentId?: string,
): Request {
  return new Request("http://localhost:3000/api/v1/documents", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [DEV_USER_HEADER]: userId,
    },
    body: JSON.stringify({
      tenantId,
      title: "Widget policy",
      source: "policy.md",
      documentType: "text",
      content,
      newVersion,
      ...(supersedesDocumentId ? { supersedesDocumentId } : {}),
    }),
  });
}

function change(
  tenantId: string,
  userId: string,
  documentId: string,
  action: "publish" | "retire" | "reindex",
): Request {
  return new Request(
    `http://localhost:3000/api/v1/documents/${documentId}/${action}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [DEV_USER_HEADER]: userId,
      },
      body: JSON.stringify({ tenantId }),
    },
  );
}

async function countDocuments(
  tx: TenantQueryClient,
  tenantId: string,
): Promise<number> {
  const rows = await tx
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.tenantId, tenantId));
  return rows.length;
}

async function withRollback(
  run: (tx: TenantQueryClient) => Promise<void>,
): Promise<void> {
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

function slug(label: string): string {
  return `ingest-${label}-${randomUUID().slice(0, 8)}`;
}
