import "server-only";

import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { logDatabaseFailure, poolConfig } from "@/server/db/client";

export async function pingDatabase(db: NodePgDatabase): Promise<"up" | "down"> {
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
