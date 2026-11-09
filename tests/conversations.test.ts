import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import type { GroundedAnswer } from "@/server/answers/generate";
import { createConversationHandlers } from "@/server/conversations/handlers";
import {
  citationValidationFor,
  supportMessageBodySchema,
} from "@/server/conversations/schema";
import { fromGrounded } from "@/server/conversations/answer";
import {
  rateBucketKeyPattern,
  supportRateBucketKey,
} from "@/server/conversations/rate-limit";

const tenantId = "11111111-1111-4111-8111-111111111111";
const userId = "10000000-0000-4000-8000-000000000004";

describe("support message body", () => {
  it("accepts a question and an optional conversation id", () => {
    const conversationId = randomUUID();
    expect(
      supportMessageBodySchema.parse({
        question: " When does it ship? ",
        conversationId,
      }),
    ).toEqual({
      question: "When does it ship?",
      conversationId,
    });
  });

  it("rejects order, user, tenant, and history fields", () => {
    const rejected = [
      { question: "Where is order 9?", orderId: "9" },
      { question: "Hi", userId },
      { question: "Hi", tenantId },
      { question: "Hi", history: [{ role: "user", body: "earlier" }] },
      { question: "Hi", tools: ["order:read"] },
    ];
    for (const body of rejected) {
      expect(supportMessageBodySchema.safeParse(body).success).toBe(false);
    }
  });
});

describe("conversation audit metadata", () => {
  it("keeps a grounded answer and an abstention distinguishable", () => {
    const grounded = fromGrounded(sampleAnswer("grounded"));
    const abstained = fromGrounded(sampleAnswer("model_abstained"));
    expect(grounded.outcome).toBe("answered");
    expect(grounded.citationValidation).toBe("passed");
    expect(grounded.modelId).toBe("fixture-model");
    expect(abstained.outcome).toBe("abstained");
    expect(abstained.citationValidation).toBe("not_applicable");
    expect(citationValidationFor("invented_citation")).toBe("failed");
    expect(abstained.citations).toEqual([]);
  });

  it("drops a model id that is not a short token", () => {
    const answer = fromGrounded({
      ...sampleAnswer("grounded"),
      model: "model with spaces",
    });
    expect(answer.modelId).toBeNull();
  });
});

describe("support rate bucket keys", () => {
  it("uses the user id for a customer and a hash for a logged-out caller", () => {
    const userKey = supportRateBucketKey({
      tenantId,
      userId,
      forwardedFor: "203.0.113.4, 10.0.0.1",
    });
    const publicKey = supportRateBucketKey({
      tenantId,
      userId: null,
      forwardedFor: "203.0.113.4, 10.0.0.1",
    });
    const otherAddress = supportRateBucketKey({
      tenantId,
      userId: null,
      forwardedFor: "203.0.113.9",
    });
    expect(userKey).toBe(`user:${tenantId}:${userId}`);
    expect(publicKey).not.toContain("203.0.113.4");
    expect(publicKey).not.toBe(otherAddress);
    expect(rateBucketKeyPattern.test(userKey)).toBe(true);
    expect(rateBucketKeyPattern.test(publicKey)).toBe(true);
  });
});

describe("support message route validation", () => {
  it("rejects an order field before it touches the database", async () => {
    const handlers = createConversationHandlers({
      db: () => {
        throw new Error("database was opened");
      },
    });
    const response = await handlers.post(
      new Request("http://localhost:3000/api/v1/support/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": randomUUID(),
        },
        body: JSON.stringify({
          question: "Look up order 9",
          orderId: "9",
        }),
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "validation_failed" });
  });
});

function sampleAnswer(reason: GroundedAnswer["reason"]): GroundedAnswer {
  const answered = reason === "grounded";
  return {
    outcome: answered ? "answered" : "abstained",
    answer: answered
      ? "Widgets ship in two business days."
      : "I don't have enough published information to answer that.",
    citations: answered
      ? [
          {
            chunkId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            documentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            title: "Shipping",
            section: null,
            documentVersion: 1,
            effectiveDate: null,
            excerpt: "Harbor ships widgets in two business days.",
          },
        ]
      : [],
    abstained: !answered,
    conflict: false,
    conflictResolved: false,
    reason,
    model: "fixture-model",
    usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7 },
  };
}
