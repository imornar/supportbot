import "server-only";

import { sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { logDatabaseFailure, poolConfig } from "@/server/db/client";

type Queryable = {
  execute: (query: SQL) => Promise<unknown>;
};

export async function pingDatabase(db: Queryable): Promise<"up" | "down"> {
  try {
    await db.execute(sql`select 1`);
    return "up";
  } catch (error) {
    logDatabaseFailure(error);
    return "down";
  }
}

export async function pingConnectionString(
  connectionString: string,
): Promise<"up" | "down"> {
  const pool = new Pool(poolConfig(connectionString));
  try {
    return await pingDatabase(drizzle({ client: pool }));
  } finally {
    await pool.end();
  }
}
