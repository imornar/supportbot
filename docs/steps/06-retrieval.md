# Step 06: Tenant-scoped retrieval

- Phase: Knowledge and AI
- Depends on: 05
- Status: in_review
- Spec: sections 10, 18

## Goal

Search only the current tenant's published chunks, and return evidence with enough metadata to cite it later.

## In scope

- Retrieval function: tenant id, query embedding, top-k, similarity threshold, published and not retired, current version.
- Filters for effective date when metadata exists.
- Returned evidence includes chunk id, document id, title, section, text, and score.
- Tests: tenant B documents are invisible to tenant A. Retired and draft documents are invisible. Low scores are dropped.
- A small checked-in dataset of queries and expected document ids, using fixture embeddings, not live OpenAI.
- Optional hybrid keyword plus vector search only if a fixture shows it helps. Otherwise document why vector-only is enough for now.
- `docs/evaluation.md` started with this dataset and its limits.

## Out of scope

- Calling a chat model. Citation validation of generated text belongs to Step 07.

## Acceptance criteria

- Cross-tenant retrieval test fails if the tenant predicate is removed.
- Threshold and top-k are configuration, not hardcoded in the route.
- Every result can be traced to a stored chunk.

## Security and deployment

The retriever takes a server-resolved tenant id. It must not accept a tenant id from the model or the browser as authority.

## Checks

Retrieval integration tests against Postgres, dataset assertions, lint, typecheck, build.

## Learn in review

How you would show a reviewer that isolation is in the query, not in the prompt. How freshness and conflicts will be handled before an answer is trusted.

## PR title

`Step 06: Retrieve published evidence inside one tenant`
