import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Ownership model for later tables.
 *
 * `users` are global identity records. They have no password column and no
 * tenant id. Auth.js stores the provider name and provider subject here after
 * a verified link. Tenant ownership starts at `tenant_memberships`. A role
 * assignment stores the same tenant id as its membership, and the composite
 * foreign key rejects a role in tenant B for a membership in tenant A.
 *
 * Row Level Security is not enabled. See docs/security.md. Every query helper
 * in this package still has to take a tenant id and filter on it.
 */

export const membershipStatus = pgEnum("membership_status", [
  "active",
  "deactivated",
]);

export const appRole = pgEnum("app_role", [
  "customer",
  "knowledge_manager",
  "support_agent",
  "tenant_admin",
]);

export const documentType = pgEnum("document_type", ["markdown", "text"]);

export const documentPublication = pgEnum("document_publication", [
  "draft",
  "published",
  "retired",
]);

export const ingestionStatus = pgEnum("ingestion_status", [
  "pending",
  "ready",
  "failed",
]);

export const embeddingDimensions = 1536;

const embeddingVector = customType<{
  data: number[];
  driverData: string;
  config: { dimensions: number };
  configRequired: true;
}>({
  dataType(config) {
    return `vector(${config.dimensions})`;
  },
  toDriver(value: number[]) {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string) {
    const trimmed = value.trim();
    const inner =
      trimmed.startsWith("[") && trimmed.endsWith("]")
        ? trimmed.slice(1, -1)
        : trimmed;
    if (!inner) {
      return [];
    }
    return inner.split(",").map((part) => Number(part));
  },
});

function timestamps() {
  return {
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  };
}

export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("tenants_slug_unique").on(table.slug),
    check(
      "tenants_slug_shape",
      sql`${table.slug} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`,
    ),
    check(
      "tenants_name_length",
      sql`char_length(${table.name}) between 1 and 120`,
    ),
  ],
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    authProvider: text("auth_provider"),
    authSubject: text("auth_subject"),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("users_email_unique").on(table.email),
    uniqueIndex("users_auth_identity_unique").on(
      table.authProvider,
      table.authSubject,
    ),
    check(
      "users_email_normalized",
      sql`${table.email} = lower(${table.email}) and ${table.email} ~ '^[^@[:space:]]+@[^@[:space:]]+$' and char_length(${table.email}) <= 320`,
    ),
    check(
      "users_display_name_length",
      sql`char_length(${table.displayName}) between 1 and 120`,
    ),
    check(
      "users_auth_identity_pair",
      sql`(
        ${table.authProvider} is null and ${table.authSubject} is null
      ) or (
        ${table.authProvider} is not null and ${table.authSubject} is not null
      )`,
    ),
    check(
      "users_auth_provider_shape",
      sql`${table.authProvider} is null or ${table.authProvider} ~ '^[a-z][a-z0-9_-]{0,31}$'`,
    ),
    check(
      "users_auth_subject_shape",
      sql`${table.authSubject} is null or (
        char_length(${table.authSubject}) between 1 and 255
        and ${table.authSubject} !~ '[[:space:]]'
      )`,
    ),
  ],
);

export const tenantMemberships = pgTable(
  "tenant_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    status: membershipStatus("status").notNull().default("active"),
    ...timestamps(),
  },
  (table) => [
    unique("tenant_memberships_tenant_user_unique").on(
      table.tenantId,
      table.userId,
    ),
    unique("tenant_memberships_id_tenant_unique").on(table.id, table.tenantId),
  ],
);

export const roleAssignments = pgTable(
  "role_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    membershipId: uuid("membership_id").notNull(),
    role: appRole("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("role_assignments_membership_role_unique").on(
      table.membershipId,
      table.role,
    ),
    index("role_assignments_tenant_id_idx").on(table.tenantId),
    foreignKey({
      name: "role_assignments_membership_tenant_fk",
      columns: [table.membershipId, table.tenantId],
      foreignColumns: [tenantMemberships.id, tenantMemberships.tenantId],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("audit_events_tenant_created_idx").on(
      table.tenantId,
      table.createdAt,
    ),
    check(
      "audit_events_action_shape",
      sql`${table.action} ~ '^[a-z0-9_.:]{1,64}$'`,
    ),
    check(
      "audit_events_target_type_shape",
      sql`${table.targetType} ~ '^[a-z][a-z0-9_]{0,63}$'`,
    ),
  ],
);

/**
 * Knowledge documents live in Postgres. The body is untrusted text. Nothing
 * in this table is executed, and local disk is not the store.
 * `is_current` marks the live row for a checksum. A new version clears it on
 * the previous row. Retirement clears it too, so the same text can be stored
 * again later. Queries still have to filter on tenant id.
 */
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    title: text("title").notNull(),
    source: text("source").notNull(),
    documentType: documentType("document_type").notNull(),
    version: integer("version").notNull(),
    publication: documentPublication("publication").notNull().default("draft"),
    checksum: text("checksum").notNull(),
    body: text("body").notNull(),
    uploadedByUserId: uuid("uploaded_by_user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    effectiveDate: date("effective_date", { mode: "string" }),
    ingestionStatus: ingestionStatus("ingestion_status")
      .notNull()
      .default("pending"),
    failureReason: text("failure_reason"),
    isCurrent: boolean("is_current").notNull().default(true),
    supersedesDocumentId: uuid("supersedes_document_id"),
    retiredAt: timestamp("retired_at", { withTimezone: true, mode: "date" }),
    ...timestamps(),
  },
  (table) => [
    unique("documents_id_tenant_unique").on(table.id, table.tenantId),
    unique("documents_id_version_unique").on(table.id, table.version),
    uniqueIndex("documents_current_checksum_unique")
      .on(table.tenantId, table.checksum)
      .where(sql`${table.isCurrent} = true`),
    index("documents_tenant_id_idx").on(table.tenantId),
    foreignKey({
      name: "documents_supersedes_tenant_fk",
      columns: [table.supersedesDocumentId, table.tenantId],
      foreignColumns: [table.id, table.tenantId],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    check(
      "documents_title_length",
      sql`char_length(${table.title}) between 1 and 200`,
    ),
    check(
      "documents_source_length",
      sql`char_length(${table.source}) between 1 and 500`,
    ),
    check("documents_version_positive", sql`${table.version} >= 1`),
    check(
      "documents_checksum_shape",
      sql`${table.checksum} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "documents_body_size",
      sql`octet_length(${table.body}) between 1 and 262144`,
    ),
    check(
      "documents_not_self_supersede",
      sql`${table.supersedesDocumentId} is null or ${table.supersedesDocumentId} <> ${table.id}`,
    ),
    check(
      "documents_retired_not_current",
      sql`${table.publication} <> 'retired' or ${table.isCurrent} = false`,
    ),
    check(
      "documents_failure_reason",
      sql`(
        ${table.ingestionStatus} = 'failed'
        and ${table.failureReason} in (
          'too_large_for_sync_ingestion',
          'embedding_not_configured',
          'embedding_failed',
          'ingestion_failed'
        )
      ) or (
        ${table.ingestionStatus} <> 'failed' and ${table.failureReason} is null
      )`,
    ),
  ],
);

export const documentChunks = pgTable(
  "document_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    documentId: uuid("document_id").notNull(),
    documentVersion: integer("document_version").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    section: text("section"),
    content: text("content").notNull(),
    embedding: embeddingVector("embedding", {
      dimensions: embeddingDimensions,
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("document_chunks_document_index_unique").on(
      table.documentId,
      table.chunkIndex,
    ),
    index("document_chunks_tenant_document_idx").on(
      table.tenantId,
      table.documentId,
    ),
    index("document_chunks_embedding_hnsw").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops"),
    ),
    foreignKey({
      name: "document_chunks_document_tenant_fk",
      columns: [table.documentId, table.tenantId],
      foreignColumns: [documents.id, documents.tenantId],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      name: "document_chunks_document_version_fk",
      columns: [table.documentId, table.documentVersion],
      foreignColumns: [documents.id, documents.version],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    check("document_chunks_index_non_negative", sql`${table.chunkIndex} >= 0`),
    check(
      "document_chunks_version_positive",
      sql`${table.documentVersion} >= 1`,
    ),
    check(
      "document_chunks_content_length",
      sql`char_length(${table.content}) between 1 and 2000`,
    ),
    check(
      "document_chunks_section_length",
      sql`${table.section} is null or char_length(${table.section}) between 1 and 500`,
    ),
  ],
);
