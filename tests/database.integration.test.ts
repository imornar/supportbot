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
});

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
