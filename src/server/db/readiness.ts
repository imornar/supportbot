import "server-only";

import { getDb } from "@/server/db/client";
import { pingConnectionString, pingDatabase } from "@/server/db/ping";
import { databaseUrlConfigured } from "@/server/env";
import type { DatabaseState } from "@/server/health";

export async function checkDatabase(
  source: Record<string, string | undefined> = process.env,
): Promise<DatabaseState> {
  const connectionString = source.DATABASE_URL?.trim();
  if (!connectionString || !databaseUrlConfigured(source)) {
    return "not_configured";
  }

  if (source === process.env) {
    return pingDatabase(getDb());
  }

  return pingConnectionString(connectionString);
}
