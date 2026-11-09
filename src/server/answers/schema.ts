import { z } from "zod";

/** A grounded answer has to name at least this many retrieved chunks. */
export const minimumCitationCount = 1;

export const maxQuestionChars = 2_000;
export const maxAnswerChars = 4_000;
export const maxModelCitations = 20;

/**
 * The model is only allowed to name chunk ids. Titles, sections, and excerpt
 * text are copied from the evidence set after this schema parses.
 */
export const modelAnswerSchema = z
  .object({
    answer: z.string().max(maxAnswerChars),
    citations: z
      .array(
        z
          .object({
            chunkId: z.uuid(),
          })
          .strict(),
      )
      .max(maxModelCitations),
    abstained: z.boolean(),
    conflict: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.abstained && value.answer.trim().length === 0) {
      context.addIssue({
        code: "custom",
        path: ["answer"],
        message: "answer_required",
      });
    }
  });

export type ModelAnswer = z.infer<typeof modelAnswerSchema>;
