# Step 17: Reliability and observability

- Phase: Quality and production
- Depends on: 09, 11
- Status: not_started
- Spec: sections 16, 17

## Goal

Make failures visible and bounded: timeouts, retries, correlation ids, and safe logs.

## In scope

- Structured logger with a correlation id per request and workflow run.
- Log model name, token counts, latency, retrieval count, outcome, escalation reason, and error category.
- Redaction test: an API key and a bearer token in a sample payload do not appear in the log line.
- Do not log full conversation content by default.
- Retry policy module: retry only marked transient errors, with a max attempt count and backoff. Non-idempotent ticket creates rely on the idempotency key from Step 11.
- Timeouts already added stay covered by tests.
- Observability vendor is optional. The app starts when it is unset.
- Document which operations are synchronous and which are still in-request.

## Out of scope

- A full job queue, unless ingestion from Step 05 is still failing inside the request limit. If so, add the smallest durable mechanism that fixes that, and document it.

## Acceptance criteria

- A forced model timeout becomes a safe client error and an escalation or abstention, not a fabricated answer.
- Log snapshot test proves redaction.
- Cost estimate is computed from token counts when prices are configured, and omitted when they are not.

## Security and deployment

Logs are not a second database of customer conversations.

## Checks

Retry and redaction tests, lint, typecheck, build.

## Learn in review

What you would look at during an incident, and which failures you refuse to retry.

## PR title

`Step 17: Add timeouts, safe retries, and structured logs`
