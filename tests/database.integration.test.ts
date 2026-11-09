import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closePool, getDb } from "@/server/db/client";
import { checkDatabase } from "@/server/db/readiness";

const databaseUrl = process.env.DATABASE_URL?.trim();

describe("migration files", () => {
  it("enables pgvector in SQL instead of a manual setup step", () => {
    const migration = readFileSync(
      path.join(process.cwd(), "drizzle/0000_enable_vector.sql"),
      "utf8",
    );
    expect(migration).toMatch(/CREATE EXTENSION IF NOT EXISTS vector\s*;/);
  });

  it("does not apply migrations from application source", () => {
    const offenders = sourceFiles(path.join(process.cwd(), "src")).filter(
      (file) =>
        file.source.includes("drizzle-orm/node-postgres/migrator") ||
        file.source.includes("drizzle-kit"),
    );
    expect(offenders.map((file) => file.path)).toEqual([]);
  });
});

describe.skipIf(!databaseUrl)("postgres", () => {
  afterAll(async () => {
    await closePool();
  });

  it("answers a query after the vector extension migration", async () => {
    const extension = await getDb().execute<{ extname: string }>(
      sql`select extname from pg_extension where extname = 'vector'`,
    );
    expect(extension.rows).toEqual([{ extname: "vector" }]);

    const readiness = await checkDatabase();
    expect(readiness).toBe("up");
  });

  it("applies migrations again without further schema changes", async () => {
    const journal = JSON.parse(
      readFileSync(
        path.join(process.cwd(), "drizzle/meta/_journal.json"),
        "utf8",
      ),
    ) as { entries: unknown[] };
    const before = await migrationCount();
    expect(before).toBe(journal.entries.length);
    execFileSync("npm", ["run", "db:migrate"], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "pipe",
    });
    expect(await migrationCount()).toBe(before);

    const tables = await getDb().execute<{ tablename: string }>(sql`
      select tablename
      from pg_tables
      where schemaname = 'public'
        and tablename in (
          'tenants',
          'users',
          'tenant_memberships',
          'role_assignments',
          'audit_events',
          'documents',
          'document_chunks',
          'conversations',
          'customers',
          'orders',
          'messages',
          'support_submissions',
          'support_rate_buckets',
          'tickets',
          'ticket_messages'
        )
    `);
    expect(tables.rows.map((row) => row.tablename).sort()).toEqual([
      "audit_events",
      "conversations",
      "customers",
      "document_chunks",
      "documents",
      "messages",
      "orders",
      "role_assignments",
      "support_rate_buckets",
      "support_submissions",
      "tenant_memberships",
      "tenants",
      "ticket_messages",
      "tickets",
      "users",
    ]);
  });

  it("stores users and audit events without secret or payload columns", async () => {
    const columns = await getDb().execute<{
      table_name: string;
      column_name: string;
    }>(sql`
      select table_name, column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name in ('users', 'audit_events', 'messages')
    `);
    const names = columns.rows.map(
      (row) => `${row.table_name}.${row.column_name}`,
    );
    expect(names).not.toContain("users.password");
    expect(names).not.toContain("users.password_hash");
    expect(names.some((name) => name.startsWith("audit_events.payload"))).toBe(
      false,
    );
    expect(names).not.toContain("audit_events.metadata");
    expect(names).not.toContain("messages.payload");
    expect(names).not.toContain("messages.provider_response");
    expect(names).not.toContain("messages.usage");
    expect(names).toEqual(
      expect.arrayContaining([
        "messages.outcome",
        "messages.citation_validation",
        "messages.model_id",
        "messages.answer_reason",
        "messages.workflow_intent",
        "messages.escalation_reason",
      ]),
    );
    expect(names).toEqual(
      expect.arrayContaining([
        "users.email",
        "users.auth_provider",
        "users.auth_subject",
        "audit_events.tenant_id",
        "audit_events.actor_user_id",
        "audit_events.action",
        "audit_events.target_type",
        "audit_events.target_id",
      ]),
    );
  });
});

async function migrationCount(): Promise<number> {
  const rows = await getDb().execute<{ count: string }>(
    sql`select count(*)::text as count from public.__drizzle_migrations`,
  );
  return Number(rows.rows[0]?.count ?? 0);
}

function sourceFiles(directory: string): { path: string; source: string }[] {
  const files: { path: string; source: string }[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(fullPath));
      continue;
    }
    if (fullPath.endsWith(".ts") || fullPath.endsWith(".tsx")) {
      files.push({ path: fullPath, source: readFileSync(fullPath, "utf8") });
    }
  }
  return files;
}
