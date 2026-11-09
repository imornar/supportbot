import type { RetrievedEvidence } from "@/server/retrieval/retrieve";

import type { ModelAnswer } from "@/server/answers/schema";

export type PublicCitation = {
  chunkId: string;
  documentId: string;
  title: string;
  section: string | null;
  documentVersion: number;
  effectiveDate: string | null;
  excerpt: string;
};

export type CitationValidation =
  { ok: true; citations: PublicCitation[] } | { ok: false };

/**
 * Every cited id has to be a chunk that was passed to the model. One unknown
 * id fails the whole set, so a mix of real and invented ids cannot be returned
 * with the invented id removed and the answer kept.
 */
export function validateCitations(
  citations: ModelAnswer["citations"],
  evidence: readonly RetrievedEvidence[],
): CitationValidation {
  const byId = new Map(evidence.map((item) => [item.chunkId, item]));
  const seen = new Set<string>();
  const validated: PublicCitation[] = [];

  for (const citation of citations) {
    const item = byId.get(citation.chunkId);
    if (!item) {
      return { ok: false };
    }
    if (seen.has(item.chunkId)) {
      continue;
    }
    seen.add(item.chunkId);
    validated.push({
      chunkId: item.chunkId,
      documentId: item.documentId,
      title: item.title,
      section: item.section,
      documentVersion: item.documentVersion,
      effectiveDate: item.effectiveDate,
      excerpt: item.text,
    });
  }

  return { ok: true, citations: validated };
}
