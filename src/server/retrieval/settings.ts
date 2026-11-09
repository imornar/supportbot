import "server-only";

export const defaultRetrievalTopK = 5;
export const defaultRetrievalSimilarityThreshold = 0.3;
export const maxRetrievalTopK = 20;

const topKError =
  "Invalid retrieval configuration: RETRIEVAL_TOP_K must be an integer from 1 to 20. Values are omitted.";
const thresholdError =
  "Invalid retrieval configuration: RETRIEVAL_SIMILARITY_THRESHOLD must be a number from 0 to 1. Values are omitted.";

export type RetrievalSettings = {
  topK: number;
  similarityThreshold: number;
};

/**
 * Defaults live here. `retrieveEvidence` does not invent a top-k or a
 * threshold, so a later route has to pass the result of this parser.
 */
export function parseRetrievalSettings(
  source: Record<string, string | undefined>,
): RetrievalSettings {
  const settings = {
    topK: readTopK(source.RETRIEVAL_TOP_K),
    similarityThreshold: readThreshold(source.RETRIEVAL_SIMILARITY_THRESHOLD),
  };
  assertRetrievalSettings(settings);
  return settings;
}

export function getRetrievalSettings(): RetrievalSettings {
  return parseRetrievalSettings(process.env);
}

export function assertRetrievalSettings(settings: RetrievalSettings): void {
  if (!isTopK(settings.topK)) {
    throw new Error(topKError);
  }
  if (!isThreshold(settings.similarityThreshold)) {
    throw new Error(thresholdError);
  }
}

function readTopK(value: string | undefined): number {
  if (value === undefined || value.trim() === "") {
    return defaultRetrievalTopK;
  }
  if (!/^[1-9]\d*$/.test(value.trim())) {
    throw new Error(topKError);
  }
  return Number(value.trim());
}

function readThreshold(value: string | undefined): number {
  if (value === undefined || value.trim() === "") {
    return defaultRetrievalSimilarityThreshold;
  }
  const trimmed = value.trim();
  if (!/^(?:0|1)(?:\.\d+)?$|^0?\.\d+$/.test(trimmed)) {
    throw new Error(thresholdError);
  }
  return Number(trimmed);
}

function isTopK(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= maxRetrievalTopK;
}

function isThreshold(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}
