import "server-only";

import { createHash } from "node:crypto";
import OpenAI from "openai";

import { embeddingDimensions } from "@/server/db/schema";

export const embeddingModel = "text-embedding-3-small";
const embeddingTimeoutMs = 10_000;
const placeholderKeys = new Set(["", "replace-me"]);

export class EmbeddingError extends Error {
  readonly code: "embedding_failed" | "embedding_not_configured";

  constructor(code: "embedding_failed" | "embedding_not_configured") {
    super("Embedding failed. Values are omitted.");
    this.name = "EmbeddingError";
    this.code = code;
  }
}

export type EmbeddingProvider = {
  model: string;
  dimensions: number;
  embed(texts: readonly string[]): Promise<number[][]>;
};

export function fakeEmbedder(): EmbeddingProvider {
  return {
    model: "fake",
    dimensions: embeddingDimensions,
    async embed(texts) {
      return texts.map((text) => fakeVector(text));
    },
  };
}

export function openAiEmbedder(apiKey: string): EmbeddingProvider {
  return {
    model: embeddingModel,
    dimensions: embeddingDimensions,
    async embed(texts) {
      if (texts.length === 0) {
        return [];
      }
      const client = new OpenAI({
        apiKey,
        timeout: embeddingTimeoutMs,
        maxRetries: 2,
      });
      try {
        const response = await client.embeddings.create({
          model: embeddingModel,
          input: [...texts],
          dimensions: embeddingDimensions,
        });
        const ordered = [...response.data].sort(
          (left, right) => left.index - right.index,
        );
        if (
          ordered.length !== texts.length ||
          ordered.some((item) => item.embedding.length !== embeddingDimensions)
        ) {
          throw new EmbeddingError("embedding_failed");
        }
        return ordered.map((item) => item.embedding);
      } catch (error) {
        if (error instanceof EmbeddingError) {
          throw error;
        }
        throw new EmbeddingError("embedding_failed");
      }
    },
  };
}

/**
 * A real key uses OpenAI. Development and test, including the `.env.example`
 * placeholder, use the fake embedder so ingestion can run without a key.
 * Production and preview do not invent vectors when the key is missing.
 */
export function createEmbeddingProvider(
  env: Record<string, string | undefined>,
): EmbeddingProvider {
  const key = env.OPENAI_API_KEY?.trim() ?? "";
  if (!placeholderKeys.has(key)) {
    return openAiEmbedder(key);
  }
  if (isDeployedRuntime(env)) {
    return {
      model: embeddingModel,
      dimensions: embeddingDimensions,
      async embed() {
        throw new EmbeddingError("embedding_not_configured");
      },
    };
  }
  return fakeEmbedder();
}

function isDeployedRuntime(env: Record<string, string | undefined>): boolean {
  return (
    env.NODE_ENV === "production" ||
    env.VERCEL_ENV === "production" ||
    env.VERCEL_ENV === "preview"
  );
}

function fakeVector(text: string): number[] {
  const hash = createHash("sha256").update(text).digest();
  const vector = new Array<number>(embeddingDimensions);
  for (let index = 0; index < embeddingDimensions; index += 1) {
    const byte = hash[index % hash.length] ?? 0;
    vector[index] = byte / 127.5 - 1;
  }
  return vector;
}
