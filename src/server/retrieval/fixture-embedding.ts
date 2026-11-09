import "server-only";

import { embeddingDimensions } from "@/server/db/schema";

export type FixtureComponent = {
  basis: number;
  weight: number;
};

/**
 * Sparse axes for the checked-in retrieval dataset. Same basis and weight
 * produce the same vector. Different bases are orthogonal, so a label does
 * not depend on OpenAI or on the hash embedder.
 */
export function fixtureEmbedding(
  components: readonly FixtureComponent[],
): number[] {
  const vector = new Array<number>(embeddingDimensions).fill(0);
  for (const component of components) {
    if (
      !Number.isInteger(component.basis) ||
      component.basis < 0 ||
      component.basis >= embeddingDimensions ||
      !Number.isFinite(component.weight)
    ) {
      throw new Error("Invalid fixture embedding. Values are omitted.");
    }
    vector[component.basis] = component.weight;
  }
  return vector;
}

export function cosineSimilarity(
  left: readonly number[],
  right: readonly number[],
): number {
  const length = Math.min(left.length, right.length);
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}
