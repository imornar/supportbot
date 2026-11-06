# Step 08: Conversations API

- Phase: Knowledge and AI
- Depends on: 04, 07
- Status: not_started
- Spec: sections 9.1, 14

## Goal

Persist customer questions and validated answers, with authorization and rate limits.

## In scope

- Tables: `conversations`, `messages`. Tenant id and optional customer user id.
- `POST /api/v1/support/messages`, `GET /api/v1/conversations`, `GET /api/v1/conversations/:id`.
- Zod request and response schemas. Stable error codes. No stack traces.
- Public general questions are allowed only when the handler marks the conversation as non-private. Private history requires the owner.
- Rate limit for the message endpoint using a store that survives a second serverless instance, or a documented database counter. Do not use a process-local `Map` as the production limiter.
- Idempotency key so a repeated post does not create two conversations for one submit.
- Wire the handler to retrieval and the grounded answer service.
- Audit metadata: outcome, citation validation, model id. Do not store the raw provider payload if it may contain document text you would not put in logs. Message rows are the product record, not the log.

## Out of scope

- LangGraph graph, tickets, order tools, polished UI.

## Acceptance criteria

- Customer A cannot read customer B's conversation. Test it.
- A validated answer and an abstention are both persisted and distinguishable.
- Duplicate idempotency key returns the original result.
- Public route cannot request order data or another user's history.

## Security and deployment

Tenant context comes from the session or from an explicit public tenant selected by server configuration, not from an unchecked body field. Document which tenant a logged-out demo uses.

## Checks

Route tests with mocked model and real or test database, lint, typecheck, build.

## Learn in review

Where the HTTP boundary sits relative to the model, and which fields a client is allowed to send.

## PR title

`Step 08: Persist authorized support conversations`
