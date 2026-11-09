# Step 05: Document ingestion

- Phase: Knowledge and AI
- Depends on: 04
- Status: done
- Spec: sections 9.2, 10, 16

## Goal

Let a Knowledge Manager store Markdown or plain text, chunk it, embed it, and see success or failure. Retrieval quality comes in the next step.

## In scope

- `documents` and `document_chunks` with tenant id, version, checksum, status, and source metadata from the spec.
- Permission checks: `document:create`, `document:read`, `document:update`, `document:retire`.
- Upload limits, content-type checks, and stored text in Postgres. No local disk as the store.
- Chunker with unit tests.
- Embedding provider interface. CI uses a fake embedder. A live OpenAI embedder is behind configuration and is not required for tests.
- Status lifecycle: pending, ready, failed. Failures store a safe reason.
- Publish, supersede, and retire without deleting history.
- If embedding cannot finish inside a normal serverless limit, persist the job state and document the durable worker as follow-up rather than blocking the request forever. Prefer a simple synchronous path only for small files, with a hard size where the request stops and records failure.

## Out of scope

- PDF, search API, answer generation, customer UI beyond what is required to exercise the API.

## Acceptance criteria

- A member without permission cannot upload.
- A document is not `ready` if embedding fails.
- Chunks are stored with tenant and document version.
- Re-uploading the same checksum does not create a duplicate ready document unless a new version is requested.
- Tests use the fake embedder.

## Security and deployment

Uploaded text is untrusted content. Do not execute it. Do not send secrets in the embedding error path. Record the uploader on the audit log.

## Checks

Chunking tests, permission tests, ingestion test with fake embeddings, lint, typecheck, build.

## Learn in review

Why ingestion status exists, why the embedding provider is replaceable, and what breaks if a Vercel function tries to index a large file inline.

## PR title

`Step 05: Ingest tenant documents into pgvector`
