import { describe, expect, it, vi } from "vitest";
import { ForbiddenError } from "@/server/auth/access";
import { CHUNK_TARGET_CHARS } from "@/server/documents/chunk";
import { chunkDocument } from "@/server/documents/chunk";
import {
  createEmbeddingProvider,
  EmbeddingError,
  fakeEmbedder,
} from "@/server/documents/embed";
import { createDocumentHandlers } from "@/server/documents/handlers";
import { DOCUMENT_MAX_BYTES } from "@/server/documents/limits";
import { seedUsers } from "@/server/db/seed-data";

const ken = seedUsers[1];
const tenantId = "11111111-1111-4111-8111-111111111111";

describe("chunkDocument", () => {
  it("packs short paragraphs and keeps plain text free of heading sections", () => {
    const packed = chunkDocument("text", "Alpha\n\nBeta");
    expect(packed).toEqual([
      { index: 0, section: null, text: "Alpha\n\nBeta" },
    ]);

    const literal = chunkDocument("text", "# Not a heading\n\nStill text");
    expect(literal).toEqual([
      { index: 0, section: null, text: "# Not a heading\n\nStill text" },
    ]);
  });

  it("splits markdown on headings and ignores headings inside fences", () => {
    const chunks = chunkDocument(
      "markdown",
      [
        "# Shipping",
        "",
        "Intro paragraph.",
        "",
        "## Windows",
        "",
        "Window paragraph.",
      ].join("\n"),
    );
    expect(chunks.map((chunk) => chunk.section)).toEqual([
      "Shipping",
      "Shipping / Windows",
    ]);
    expect(chunks[0]?.text).toBe("Intro paragraph.");
    expect(chunks[1]?.text).toBe("Window paragraph.");

    const fenced = chunkDocument(
      "markdown",
      [
        "# Title",
        "",
        "```",
        "# not a heading",
        "```",
        "",
        "Visible paragraph.",
      ].join("\n"),
    );
    expect(fenced.every((chunk) => chunk.section === "Title")).toBe(true);
    expect(
      fenced.some((chunk) => chunk.text.includes("Visible paragraph.")),
    ).toBe(true);
  });

  it("splits a long paragraph on a sentence boundary and overlaps the next window", () => {
    const sentence = `${"a".repeat(700)}. `;
    const text = `${sentence}${"b".repeat(800)}`;
    const chunks = chunkDocument("text", text);

    expect(chunks.length).toBe(2);
    expect(chunks[0]?.text.endsWith(".")).toBe(true);
    expect(chunks[0]?.text.length).toBeLessThanOrEqual(CHUNK_TARGET_CHARS);
    expect(chunks[1]?.text.startsWith("a")).toBe(true);
    expect(chunks[1]?.text.endsWith("b")).toBe(true);
    expect(chunks[1]?.text.length).toBeLessThanOrEqual(CHUNK_TARGET_CHARS);
  });
});

describe("embedding provider", () => {
  it("returns a stable fake vector and does not call a network client", async () => {
    const embedder = fakeEmbedder();
    const [first] = await embedder.embed(["alpha"]);
    const [second] = await embedder.embed(["alpha"]);
    const [other] = await embedder.embed(["beta"]);

    expect(first).toEqual(second);
    expect(first).toHaveLength(1536);
    expect(first).not.toEqual(other);
  });

  it("uses the fake embedder for a missing key or the example placeholder", () => {
    expect(createEmbeddingProvider({}).model).toBe("fake");
    expect(
      createEmbeddingProvider({ OPENAI_API_KEY: "replace-me" }).model,
    ).toBe("fake");
    expect(createEmbeddingProvider({ OPENAI_API_KEY: "sk-test" }).model).toBe(
      "text-embedding-3-small",
    );
  });

  it("fails closed in production and preview when the key is missing", async () => {
    const production = createEmbeddingProvider({ NODE_ENV: "production" });
    const preview = createEmbeddingProvider({ VERCEL_ENV: "preview" });
    expect(production.model).toBe("text-embedding-3-small");
    await expect(production.embed(["hello"])).rejects.toBeInstanceOf(
      EmbeddingError,
    );
    await expect(production.embed(["hello"])).rejects.toMatchObject({
      code: "embedding_not_configured",
    });
    await expect(preview.embed(["hello"])).rejects.toMatchObject({
      code: "embedding_not_configured",
    });
    try {
      await production.embed(["hello"]);
    } catch (error) {
      expect(error instanceof Error ? error.message : "").not.toContain(
        "hello",
      );
    }
  });
});

describe("document routes", () => {
  it("refuses an upload when permission is denied and does not touch the database", async () => {
    const db = vi.fn(() => {
      throw new Error("database was touched");
    });
    const handlers = createDocumentHandlers({
      authorize: async () => {
        throw new ForbiddenError();
      },
      db,
    });

    const response = await handlers.create(uploadRequest());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
    expect(db).not.toHaveBeenCalled();
  });

  it("rejects an empty or oversized document before a query", async () => {
    const db = vi.fn(() => {
      throw new Error("database was touched");
    });
    const handlers = createDocumentHandlers({
      authorize: async () => ({
        userId: ken.id,
        tenantId,
        permissions: ["document:create"],
      }),
      db,
    });

    const empty = await handlers.create(uploadRequest(" \n\n "));
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({ error: "empty_content" });

    const oversized = await handlers.create(
      uploadRequest("a".repeat(DOCUMENT_MAX_BYTES + 1)),
    );
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toEqual({ error: "payload_too_large" });
    expect(db).not.toHaveBeenCalled();
  });
});

function uploadRequest(content = "Purple widget policy."): Request {
  return new Request("http://localhost:3000/api/v1/documents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tenantId,
      title: "Widget policy",
      source: "policy.md",
      documentType: "markdown",
      content,
    }),
  });
}
