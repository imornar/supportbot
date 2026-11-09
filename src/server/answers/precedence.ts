import type { RetrievedEvidence } from "@/server/retrieval/retrieve";

export type EvidencePrecedence =
  | { status: "single_document" }
  | { status: "winner"; documentId: string }
  | { status: "unresolved" };

/**
 * Retrieval has already dropped drafts, retired rows, superseded versions,
 * and documents that are not yet effective. What remains can still disagree.
 *
 * A conflict is resolved only when every document in the evidence has an
 * effective date and one date is strictly later. A missing date does not lose
 * to a dated document: the date rule is not available, so the conflict stays
 * unresolved. Treating a missing date as older would answer more often and
 * could hide the undated document.
 */
export function resolveEvidencePrecedence(
  evidence: readonly RetrievedEvidence[],
): EvidencePrecedence {
  const documents = new Map<
    string,
    { effectiveDate: string | null; documentVersion: number }
  >();

  for (const item of evidence) {
    const existing = documents.get(item.documentId);
    if (!existing) {
      documents.set(item.documentId, {
        effectiveDate: item.effectiveDate,
        documentVersion: item.documentVersion,
      });
      continue;
    }
    if (
      existing.effectiveDate !== item.effectiveDate ||
      existing.documentVersion !== item.documentVersion
    ) {
      return { status: "unresolved" };
    }
  }

  if (documents.size <= 1) {
    return { status: "single_document" };
  }

  let latest: string | null = null;
  let winner: string | null = null;
  let tie = false;

  for (const [documentId, document] of documents) {
    if (document.effectiveDate === null) {
      return { status: "unresolved" };
    }
    if (latest === null || document.effectiveDate > latest) {
      latest = document.effectiveDate;
      winner = documentId;
      tie = false;
      continue;
    }
    if (document.effectiveDate === latest) {
      tie = true;
    }
  }

  if (tie || winner === null) {
    return { status: "unresolved" };
  }

  return { status: "winner", documentId: winner };
}
