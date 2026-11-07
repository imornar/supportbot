import "server-only";

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";

const connectionTimeoutMillis = 2_000;
const queryTimeoutMillis = 2_000;

let pool: Pool | undefined;
let database: NodePgDatabase | undefined;

export function poolConfig(connectionString: string): PoolConfig {
  const onVercel = process.env.VERCEL === "1";

  return {
    connectionString,
    // A warm Vercel instance handles one request at a time. A larger pool
    // would hold a connection per idle instance and exhaust Neon.
    max: onVercel ? 1 : 10,
    connectionTimeoutMillis,
    query_timeout: queryTimeoutMillis,
    idleTimeoutMillis: onVercel ? 5_000 : 20_000,
    allowExitOnIdle: true,
  };
}

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool(poolConfig(requireDatabaseUrl()));
    pool.on("error", (error: unknown) => {
      logDatabaseFailure(error);
    });
  }
  return pool;
}

export function getDb(): NodePgDatabase {
  database ??= drizzle({ client: getPool() });
  return database;
}

export async function closePool(): Promise<void> {
  const current = pool;
  pool = undefined;
  database = undefined;
  if (current) {
    await current.end();
  }
}

export function requireDatabaseUrl(
  source: Record<string, string | undefined> = process.env,
): string {
  const value = source.DATABASE_URL?.trim();
  if (!value) {
    throw new Error(
      "DATABASE_URL is not configured. See docs/deployment.md. Values are omitted.",
    );
  }
  return value;
}

const safeErrorCode = /^[A-Za-z0-9_]{1,32}$/;

export function logDatabaseFailure(error: unknown): void {
  const code = readErrorCode(error);
  if (code) {
    console.error(`database check failed: ${code}`);
    return;
  }
  console.error("database check failed");
}

function readErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return undefined;
  }
  const code = error.code;
  if (typeof code !== "string" || !safeErrorCode.test(code)) {
    return undefined;
  }
  return code;
}
