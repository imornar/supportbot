import "server-only";

import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";

import { supportRateBuckets } from "@/server/db/schema";
import type { TenantQueryClient } from "@/server/db/tenant-queries";

export const defaultRateLimitPerMinute = 60;
export const maxRateLimitPerMinute = 600;

const rateLimitError =
  "Invalid rate limit configuration: SUPPORTPILOT_RATE_LIMIT_PER_MINUTE must be an integer from 1 to 600. Values are omitted.";

/**
 * Same shape as the `support_rate_buckets_key_shape` check. The counter is a
 * table, so a second serverless instance sees the same window.
 */
export const rateBucketKeyPattern =
  /^(user|public):[0-9a-f-]{36}:[0-9a-f-]{36,64}$/;

export function parseRateLimitPerMinute(
  source: Record<string, string | undefined>,
): number {
  const value = source.SUPPORTPILOT_RATE_LIMIT_PER_MINUTE;
  if (value === undefined || value.trim() === "") {
    return defaultRateLimitPerMinute;
  }
  if (!/^[1-9]\d*$/.test(value.trim())) {
    throw new Error(rateLimitError);
  }
  const limit = Number(value.trim());
  if (limit > maxRateLimitPerMinute) {
    throw new Error(rateLimitError);
  }
  return limit;
}

export function supportRateBucketKey(input: {
  tenantId: string;
  userId: string | null;
  forwardedFor: string | null;
}): string {
  if (input.userId) {
    return `user:${input.tenantId.toLowerCase()}:${input.userId.toLowerCase()}`;
  }
  const address = firstForwardedAddress(input.forwardedFor);
  const hash = createHash("sha256")
    .update(`supportpilot-public-rate:${address}`)
    .digest("hex");
  return `public:${input.tenantId.toLowerCase()}:${hash}`;
}

/**
 * Increments the current one-minute bucket and reports whether this request
 * is still inside the limit. The count includes the request that crossed it.
 * Buckets older than two minutes are removed here. The key is a user id or a
 * hash of the client address, not the question.
 */
export async function consumeSupportRateLimit(
  db: TenantQueryClient,
  bucketKey: string,
  limit: number,
): Promise<boolean> {
  if (!rateBucketKeyPattern.test(bucketKey)) {
    throw new Error("Rate limit key was rejected. Values are omitted.");
  }
  return db.transaction(async (tx) => {
    await tx
      .delete(supportRateBuckets)
      .where(
        sql`${supportRateBuckets.windowStart} < now() - interval '2 minutes'`,
      );
    const [row] = await tx
      .insert(supportRateBuckets)
      .values({
        bucketKey,
        windowStart: sql<Date>`date_trunc('minute', now())`,
        requestCount: 1,
      })
      .onConflictDoUpdate({
        target: [supportRateBuckets.bucketKey, supportRateBuckets.windowStart],
        set: {
          requestCount: sql`${supportRateBuckets.requestCount} + 1`,
        },
      })
      .returning({ requestCount: supportRateBuckets.requestCount });
    const count = Number(row?.requestCount);
    return Number.isInteger(count) && count >= 1 && count <= limit;
  });
}

function firstForwardedAddress(header: string | null): string {
  const first = header?.split(",")[0]?.trim() ?? "";
  if (first.length === 0 || first.length > 64 || /[\s]/.test(first)) {
    return "unknown";
  }
  return first;
}
