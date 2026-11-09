import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
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
 * A customer is the person an order belongs to, inside one tenant.
 * `user_id` is the authenticated account. Order lookup resolves this row
 * from the session. It does not accept a customer id from model output.
 */
export const customers = pgTable(
  "customers",
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
    ...timestamps(),
  },
  (table) => [
    unique("customers_tenant_user_unique").on(table.tenantId, table.userId),
    unique("customers_id_tenant_unique").on(table.id, table.tenantId),
  ],
);

export const orderStatus = pgEnum("order_status", [
  "placed",
  "shipped",
  "delivered",
]);

/**
 * Orders are tenant-owned rows. `internal_notes` and `payment_instrument`
 * exist so a read can be wrong by selecting them. The lookup query does not.
 * The model never sends the SQL. Refunds and other writes are out of scope.
 */
export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    customerId: uuid("customer_id").notNull(),
    orderNumber: text("order_number").notNull(),
    status: orderStatus("status").notNull(),
    placedOn: date("placed_on", { mode: "string" }).notNull(),
    summary: text("summary").notNull(),
    internalNotes: text("internal_notes").notNull(),
    paymentInstrument: text("payment_instrument").notNull(),
    ...timestamps(),
  },
  (table) => [
    unique("orders_tenant_number_unique").on(table.tenantId, table.orderNumber),
    unique("orders_id_tenant_unique").on(table.id, table.tenantId),
    foreignKey({
      name: "orders_customer_tenant_fk",
      columns: [table.customerId, table.tenantId],
      foreignColumns: [customers.id, customers.tenantId],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    check("orders_number_shape", sql`${table.orderNumber} ~ '^[0-9]{1,12}$'`),
    check(
      "orders_summary_length",
      sql`char_length(${table.summary}) between 1 and 500`,
    ),
    check(
      "orders_internal_notes_length",
      sql`char_length(${table.internalNotes}) between 1 and 2000`,
    ),
    check(
      "orders_payment_instrument_length",
      sql`char_length(${table.paymentInstrument}) between 1 and 120`,
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

/**
 * A conversation belongs to one tenant. Private rows name the customer who
 * owns them. Public rows are general questions from the logged-out demo:
 * `customer_user_id` stays null and `is_private` is false. The handler sets
 * that flag. A client cannot.
 *
 * Message text is the product record. Audit metadata on an assistant message
 * is the workflow outcome, the citation check, the model id, a short reason
 * code, the intent, and an escalation reason when the outcome is escalated.
 * There is no column for the raw provider payload. A signed-in escalation
 * also inserts a ticket. The assistant sentence is written here and is not
 * rewritten when an agent later claims that ticket.
 */
export const messageRole = pgEnum("message_role", ["user", "assistant"]);

const messageOutcomeSql = sql`'answered', 'clarified', 'abstained', 'escalated'`;

export const citationValidation = pgEnum("citation_validation", [
  "passed",
  "failed",
  "not_applicable",
]);

export const submissionStatus = pgEnum("submission_status", [
  "pending",
  "complete",
]);

const groundedAnswerReasonSql = sql`'grounded', 'no_evidence', 'invalid_question', 'invalid_evidence', 'model_abstained', 'invalid_output', 'invented_citation', 'uncited', 'unresolved_conflict', 'provider_error', 'retrieval_failed'`;

const answerReasonSql = sql`'grounded', 'no_evidence', 'invalid_question', 'invalid_evidence', 'model_abstained', 'invalid_output', 'invented_citation', 'uncited', 'unresolved_conflict', 'provider_error', 'retrieval_failed', 'clarification_needed', 'customer_requested_human', 'business_tool_unavailable', 'workflow_failure', 'order_lookup', 'order_not_found', 'order_unavailable', 'sign_in_required'`;

const workflowIntentSql = sql`'human_request', 'possible_order', 'ordinary', 'needs_clarification'`;

const escalationReasonSql = sql`'customer_requested_human', 'business_tool_unavailable', 'workflow_failure'`;

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    customerUserId: uuid("customer_user_id").references(() => users.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    isPrivate: boolean("is_private").notNull(),
    ...timestamps(),
  },
  (table) => [
    unique("conversations_id_tenant_unique").on(table.id, table.tenantId),
    unique("conversations_id_tenant_customer_unique").on(
      table.id,
      table.tenantId,
      table.customerUserId,
    ),
    index("conversations_tenant_customer_updated_idx").on(
      table.tenantId,
      table.customerUserId,
      table.updatedAt,
    ),
    check(
      "conversations_private_owner",
      sql`(
        ${table.isPrivate} = true and ${table.customerUserId} is not null
      ) or (
        ${table.isPrivate} = false and ${table.customerUserId} is null
      )`,
    ),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    conversationId: uuid("conversation_id").notNull(),
    role: messageRole("role").notNull(),
    body: text("body").notNull(),
    outcome: text("outcome"),
    citationValidation: citationValidation("citation_validation"),
    modelId: text("model_id"),
    answerReason: text("answer_reason"),
    workflowIntent: text("workflow_intent"),
    escalationReason: text("escalation_reason"),
    citations: jsonb("citations")
      .$type<StoredCitation[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("messages_id_tenant_unique").on(table.id, table.tenantId),
    index("messages_conversation_created_idx").on(
      table.conversationId,
      table.createdAt,
    ),
    foreignKey({
      name: "messages_conversation_tenant_fk",
      columns: [table.conversationId, table.tenantId],
      foreignColumns: [conversations.id, conversations.tenantId],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    check(
      "messages_body_length",
      sql`char_length(${table.body}) between 1 and 4000`,
    ),
    check(
      "messages_model_id_shape",
      sql`${table.modelId} is null or ${table.modelId} ~ '^[A-Za-z0-9._:-]{1,64}$'`,
    ),
    check(
      "messages_outcome",
      sql`${table.outcome} is null or ${table.outcome} in (${messageOutcomeSql})`,
    ),
    check(
      "messages_answer_reason",
      sql`${table.answerReason} is null or ${table.answerReason} in (${answerReasonSql})`,
    ),
    check(
      "messages_workflow_intent",
      sql`${table.workflowIntent} is null or ${table.workflowIntent} in (${workflowIntentSql})`,
    ),
    check(
      "messages_escalation_reason",
      sql`${table.escalationReason} is null or ${table.escalationReason} in (${escalationReasonSql})`,
    ),
    check(
      "messages_citations_array",
      sql`jsonb_typeof(${table.citations}) = 'array' and jsonb_array_length(${table.citations}) <= 20`,
    ),
    check(
      "messages_user_has_no_audit_fields",
      sql`${table.role} <> 'user' or (
        ${table.outcome} is null
        and ${table.citationValidation} is null
        and ${table.modelId} is null
        and ${table.answerReason} is null
        and ${table.workflowIntent} is null
        and ${table.escalationReason} is null
        and ${table.citations} = '[]'::jsonb
      )`,
    ),
    check(
      "messages_assistant_audit_fields",
      sql`${table.role} <> 'assistant' or (
        ${table.outcome} is not null
        and ${table.citationValidation} is not null
        and ${table.answerReason} is not null
        and ${table.workflowIntent} is not null
        and (
          (
            ${table.outcome} = 'escalated'
            and ${table.escalationReason} is not null
            and ${table.answerReason} = ${table.escalationReason}
          ) or (
            ${table.outcome} <> 'escalated'
            and ${table.escalationReason} is null
          )
        )
        and (
          (
            ${table.workflowIntent} = 'human_request'
            and ${table.outcome} = 'escalated'
            and ${table.answerReason} = 'customer_requested_human'
          ) or (
            ${table.workflowIntent} = 'possible_order'
            and (
              (
                ${table.outcome} = 'answered'
                and ${table.answerReason} = 'order_lookup'
              ) or (
                ${table.outcome} = 'abstained'
                and ${table.answerReason} in ('order_not_found', 'order_unavailable')
              ) or (
                ${table.outcome} = 'clarified'
                and ${table.answerReason} = 'sign_in_required'
              ) or (
                ${table.outcome} = 'escalated'
                and ${table.answerReason} in ('business_tool_unavailable', 'workflow_failure')
              )
            )
          ) or (
            ${table.workflowIntent} = 'needs_clarification'
            and ${table.outcome} = 'clarified'
            and ${table.answerReason} = 'clarification_needed'
          ) or (
            ${table.workflowIntent} = 'ordinary'
            and (
              (
                ${table.outcome} in ('answered', 'abstained')
                and ${table.answerReason} in (${groundedAnswerReasonSql})
              ) or (
                ${table.outcome} = 'escalated'
                and ${table.answerReason} = 'workflow_failure'
              )
            )
          )
        )
      )`,
    ),
  ],
);

/**
 * One support ticket per open escalation reason on a private conversation.
 * `closed` is in the status enum because the spec lists it. No transition
 * writes it. `resolved_at` stays set on `reopened` and is cleared on the
 * next claim. Priority is fixed by the reason check below. There is no
 * staff override column.
 *
 * Customer-visible replies and staff notes share `ticket_messages` and are
 * separated by `visibility`. A customer read filters `visibility = customer`
 * in SQL. Notes are not a column on `tickets`.
 */
export const ticketStatus = pgEnum("ticket_status", [
  "open",
  "assigned",
  "in_progress",
  "resolved",
  "reopened",
  "closed",
]);

export const ticketPriority = pgEnum("ticket_priority", [
  "low",
  "normal",
  "high",
]);

export const ticketMessageVisibility = pgEnum("ticket_message_visibility", [
  "customer",
  "internal",
]);

const ticketReasonSql = sql`'customer_requested_human', 'insufficient_evidence', 'conflicting_sources', 'repeated_attempts', 'sensitive_request', 'business_tool_unavailable', 'workflow_failure'`;

export const tickets = pgTable(
  "tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    conversationId: uuid("conversation_id").notNull(),
    requesterUserId: uuid("requester_user_id").notNull(),
    reason: text("reason").notNull(),
    priority: ticketPriority("priority").notNull(),
    status: ticketStatus("status").notNull().default("open"),
    assigneeUserId: uuid("assignee_user_id").references(() => users.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    sourceMessageId: uuid("source_message_id"),
    citations: jsonb("citations")
      .$type<StoredCitation[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    claimedAt: timestamp("claimed_at", { withTimezone: true, mode: "date" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "date" }),
    ...timestamps(),
  },
  (table) => [
    unique("tickets_id_tenant_unique").on(table.id, table.tenantId),
    uniqueIndex("tickets_active_reason_unique")
      .on(table.tenantId, table.conversationId, table.reason)
      .where(
        sql`${table.status} in ('open', 'assigned', 'in_progress', 'reopened')`,
      ),
    uniqueIndex("tickets_source_message_unique")
      .on(table.sourceMessageId)
      .where(sql`${table.sourceMessageId} is not null`),
    index("tickets_tenant_status_updated_idx").on(
      table.tenantId,
      table.status,
      table.updatedAt,
    ),
    index("tickets_tenant_requester_idx").on(
      table.tenantId,
      table.requesterUserId,
    ),
    foreignKey({
      name: "tickets_conversation_customer_fk",
      columns: [table.conversationId, table.tenantId, table.requesterUserId],
      foreignColumns: [
        conversations.id,
        conversations.tenantId,
        conversations.customerUserId,
      ],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      name: "tickets_source_message_fk",
      columns: [table.sourceMessageId, table.tenantId],
      foreignColumns: [messages.id, messages.tenantId],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    check("tickets_reason", sql`${table.reason} in (${ticketReasonSql})`),
    check(
      "tickets_priority_matches_reason",
      sql`(
        ${table.reason} in ('sensitive_request', 'conflicting_sources', 'workflow_failure')
        and ${table.priority} = 'high'
      ) or (
        ${table.reason} in ('customer_requested_human', 'business_tool_unavailable', 'repeated_attempts')
        and ${table.priority} = 'normal'
      ) or (
        ${table.reason} = 'insufficient_evidence' and ${table.priority} = 'low'
      )`,
    ),
    check(
      "tickets_citations_array",
      sql`jsonb_typeof(${table.citations}) = 'array' and jsonb_array_length(${table.citations}) <= 20`,
    ),
    check(
      "tickets_status_timestamps",
      sql`(
        ${table.status} = 'open'
        and ${table.assigneeUserId} is null
        and ${table.claimedAt} is null
        and ${table.resolvedAt} is null
      ) or (
        ${table.status} = 'assigned'
        and ${table.assigneeUserId} is not null
        and ${table.claimedAt} is not null
        and ${table.resolvedAt} is null
      ) or (
        ${table.status} = 'in_progress'
        and ${table.assigneeUserId} is not null
        and ${table.claimedAt} is not null
        and ${table.resolvedAt} is null
      ) or (
        ${table.status} = 'resolved'
        and ${table.assigneeUserId} is not null
        and ${table.claimedAt} is not null
        and ${table.resolvedAt} is not null
      ) or (
        ${table.status} = 'reopened'
        and ${table.assigneeUserId} is null
        and ${table.claimedAt} is null
        and ${table.resolvedAt} is not null
      )`,
    ),
  ],
);

export const ticketMessages = pgTable(
  "ticket_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    ticketId: uuid("ticket_id").notNull(),
    authorUserId: uuid("author_user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    visibility: ticketMessageVisibility("visibility").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("ticket_messages_ticket_created_idx").on(
      table.ticketId,
      table.createdAt,
    ),
    foreignKey({
      name: "ticket_messages_ticket_tenant_fk",
      columns: [table.ticketId, table.tenantId],
      foreignColumns: [tickets.id, tickets.tenantId],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    check(
      "ticket_messages_body_length",
      sql`char_length(${table.body}) between 1 and 4000`,
    ),
  ],
);

/**
 * One row per submit. The idempotency key is unique for a customer inside a
 * tenant, and unique for the logged-out demo inside the public tenant.
 * Pending means the model call is still in flight. Complete points at the
 * two message rows that were the original result. `ticket_id` is set when
 * that turn opened or reused a ticket, so a replay returns the same id.
 */
export const supportSubmissions = pgTable(
  "support_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    customerUserId: uuid("customer_user_id").references(() => users.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    idempotencyKey: text("idempotency_key").notNull(),
    status: submissionStatus("status").notNull().default("pending"),
    conversationId: uuid("conversation_id"),
    userMessageId: uuid("user_message_id"),
    assistantMessageId: uuid("assistant_message_id"),
    ticketId: uuid("ticket_id"),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("support_submissions_customer_key_unique")
      .on(table.tenantId, table.customerUserId, table.idempotencyKey)
      .where(sql`${table.customerUserId} is not null`),
    uniqueIndex("support_submissions_public_key_unique")
      .on(table.tenantId, table.idempotencyKey)
      .where(sql`${table.customerUserId} is null`),
    foreignKey({
      name: "support_submissions_conversation_tenant_fk",
      columns: [table.conversationId, table.tenantId],
      foreignColumns: [conversations.id, conversations.tenantId],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      name: "support_submissions_conversation_customer_fk",
      columns: [table.conversationId, table.tenantId, table.customerUserId],
      foreignColumns: [
        conversations.id,
        conversations.tenantId,
        conversations.customerUserId,
      ],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      name: "support_submissions_user_message_fk",
      columns: [table.userMessageId, table.tenantId],
      foreignColumns: [messages.id, messages.tenantId],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      name: "support_submissions_assistant_message_fk",
      columns: [table.assistantMessageId, table.tenantId],
      foreignColumns: [messages.id, messages.tenantId],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      name: "support_submissions_ticket_tenant_fk",
      columns: [table.ticketId, table.tenantId],
      foreignColumns: [tickets.id, tickets.tenantId],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    check(
      "support_submissions_key_uuid",
      sql`${table.idempotencyKey} ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`,
    ),
    check(
      "support_submissions_complete_links",
      sql`(
        ${table.status} = 'pending'
        and ${table.conversationId} is null
        and ${table.userMessageId} is null
        and ${table.assistantMessageId} is null
      ) or (
        ${table.status} = 'complete'
        and ${table.conversationId} is not null
        and ${table.userMessageId} is not null
        and ${table.assistantMessageId} is not null
        and ${table.userMessageId} <> ${table.assistantMessageId}
      )`,
    ),
  ],
);

/**
 * Fixed-window counter for `POST /api/v1/support/messages`. The key is a
 * tenant plus a user id, or a tenant plus a hash of the client address.
 * Rows older than a few minutes are deleted by the limiter. A process-local
 * map would not survive a second serverless instance, so this table is the
 * limiter.
 */
export const supportRateBuckets = pgTable(
  "support_rate_buckets",
  {
    bucketKey: text("bucket_key").notNull(),
    windowStart: timestamp("window_start", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    requestCount: integer("request_count").notNull(),
  },
  (table) => [
    unique("support_rate_buckets_key_window_unique").on(
      table.bucketKey,
      table.windowStart,
    ),
    check(
      "support_rate_buckets_key_shape",
      sql`${table.bucketKey} ~ '^(user|public):[0-9a-f-]{36}:[0-9a-f-]{36,64}$'`,
    ),
    check(
      "support_rate_buckets_count_positive",
      sql`${table.requestCount} >= 1`,
    ),
  ],
);

export type StoredCitation = {
  chunkId: string;
  documentId: string;
  title: string;
  section: string | null;
  documentVersion: number;
  effectiveDate: string | null;
  excerpt: string;
};
