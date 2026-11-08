import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
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
 * tenant id. Tenant ownership starts at `tenant_memberships`. A role
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
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("users_email_unique").on(table.email),
    check(
      "users_email_normalized",
      sql`${table.email} = lower(${table.email}) and ${table.email} ~ '^[^@[:space:]]+@[^@[:space:]]+$' and char_length(${table.email}) <= 320`,
    ),
    check(
      "users_display_name_length",
      sql`char_length(${table.displayName}) between 1 and 120`,
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
