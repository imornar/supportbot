export const SYNC_INGEST_MAX_BYTES = 64 * 1024;
export const DOCUMENT_MAX_BYTES = 256 * 1024;

export const failureReasons = [
  "too_large_for_sync_ingestion",
  "embedding_not_configured",
  "embedding_failed",
  "ingestion_failed",
] as const;

export type FailureReason = (typeof failureReasons)[number];
