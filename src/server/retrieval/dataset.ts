import "server-only";

import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const componentSchema = z.object({
  basis: z.number().int().min(0).max(1535),
  weight: z.number().finite(),
});

const documentSchema = z.object({
  key: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().trim().min(1).max(200),
  source: z.string().trim().min(1).max(500),
  section: z.string().trim().min(1).max(500),
  text: z.string().min(1).max(2000),
  basis: z.number().int().min(0).max(1535),
  publication: z.enum(["draft", "published", "retired"]),
  isCurrent: z.boolean(),
  ingestionStatus: z.enum(["ready", "failed"]),
  effectiveDate: isoDate.nullable(),
});

const querySchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  question: z.string().trim().min(1),
  components: z.array(componentSchema).min(1),
  expected: z.array(z.string().regex(/^[a-z0-9-]+$/)),
  topK: z.number().int().min(1).max(20).optional(),
  note: z.string().trim().min(1),
});

export const retrievalDatasetSchema = z.object({
  asOf: isoDate,
  topK: z.number().int().min(1).max(20),
  similarityThreshold: z.number().min(0).max(1),
  documents: z.array(documentSchema).min(1),
  queries: z.array(querySchema).min(1),
});

export type RetrievalDataset = z.infer<typeof retrievalDatasetSchema>;
export type RetrievalDatasetDocument = RetrievalDataset["documents"][number];
export type RetrievalDatasetQuery = RetrievalDataset["queries"][number];
